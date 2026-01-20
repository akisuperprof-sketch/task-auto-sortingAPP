import { NextRequest, NextResponse } from "next/server";
import { validateSignature, WebhookEvent } from "@line/bot-sdk";
import * as line from "@line/bot-sdk";
import { supabase } from "@/utils/supabaseClient";
import { model } from "@/utils/gemini";
import { Task, Priority, Status } from "@/types";

// LINE Client Configuration
const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
});

// Priority Mapping for Sorting
const priorityOrder: Record<Priority, number> = {
    'S': 0,
    'A': 1,
    'B': 2,
    'C': 3,
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.text();
        const signature = req.headers.get("x-line-signature") as string;
        const channelSecret = process.env.LINE_CHANNEL_SECRET || "";

        if (!channelSecret) {
            console.error("LINE_CHANNEL_SECRET is not set");
            return NextResponse.json({ message: "Server Error" }, { status: 500 });
        }

        if (!validateSignature(body, channelSecret, signature)) {
            return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
        }

        const events: WebhookEvent[] = JSON.parse(body).events;

        // Process all events (though usually just one in sync mode, async can be multiple)
        await Promise.all(events.map(async (event) => {
            if (event.type === "message" && event.message.type === "text") {
                await handleMessage(event.source.userId!, event.replyToken, event.message.text);
            }
        }));

        return NextResponse.json({ message: "OK" });
    } catch (error) {
        console.error("Error in webhook:", error);
        return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
    }
}

async function handleMessage(userId: string, replyToken: string, text: string) {
    const trimmedText = text.trim();

    // 1. Check for Status Update Pattern: "1 完了", "2 進行中"
    const statusRegex = /^(\d+)\s*(完了|進行中|保留|静観|戻す)$/;
    const statusMatch = trimmedText.match(statusRegex);

    if (statusMatch) {
        const displayIndex = parseInt(statusMatch[1], 10);
        const newStatus = statusMatch[2] as Status;
        await handleStatusUpdate(userId, replyToken, displayIndex, newStatus);
    } else {
        // 2. Default: New Task Analysis
        await handleNewTask(userId, replyToken, trimmedText);
    }
}

// --- Logic Handlers ---

async function handleStatusUpdate(userId: string, replyToken: string, displayIndex: number, newStatus: Status) {
    // 1. Fetch current active tasks
    const tasks = await fetchActiveTasks(userId);

    if (displayIndex < 1 || displayIndex > tasks.length) {
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: `Error: Task number ${displayIndex} not found.` }],
        });
        return;
    }

    const targetTask = tasks[displayIndex - 1]; // 1-based index

    // 2. Update Status
    const { error } = await supabase
        .from('tasks')
        .update({ status: newStatus })
        .eq('id', targetTask.id);

    if (error) {
        console.error("Supabase update error:", error);
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: "Failed to update task status." }],
        });
        return;
    }

    // 3. Reply with success and updated list
    const updatedTasks = await fetchActiveTasks(userId); // Re-fetch to show new list state
    const flexMessage = generateFlexMessage(updatedTasks);

    await client.replyMessage({
        replyToken,
        messages: [
            { type: "text", text: `Task "${targetTask.title}" updated to ${newStatus}.` },
            flexMessage
        ],
    });
}

async function handleNewTask(userId: string, replyToken: string, text: string) {
    // 1. Analyze with Gemini
    const prompt = `Analyze the text: "${text}". 
  Extract tasks. For each, determine:
  - Title (short summary)
  - Category (e.g., Work, Personal, Dev)
  - Priority (S=Urgent, A=High, B=Medium, C=Low)
  
  Return ONLY a JSON array of objects with keys: "title", "category", "priority". 
  Example: [{"title": "Buy milk", "category": "Home", "priority": "B"}]`;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Clean markdown code blocks if present
        const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsedTasks = JSON.parse(cleanJson);

        if (!Array.isArray(parsedTasks)) {
            throw new Error("Invalid format from AI");
        }

        // 2. Insert into Supabase
        const dbTasks = parsedTasks.map((t: any) => ({
            user_id: userId,
            title: t.title,
            category: t.category,
            priority: t.priority,
            status: '未処理', // Default
        }));

        const { error } = await supabase
            .from('tasks')
            .insert(dbTasks);

        if (error) {
            console.error("Supabase insert error:", error);
            await client.replyMessage({
                replyToken,
                messages: [{ type: "text", text: "Failed to save tasks." }],
            });
            return;
        }

        // 3. Reply with Flex Message
        const tasks = await fetchActiveTasks(userId);
        const flexMessage = generateFlexMessage(tasks);

        await client.replyMessage({
            replyToken,
            messages: [flexMessage],
        });

    } catch (err) {
        console.error("AI/Parsing Error:", err);
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: "Sorry, I couldn't understand that task." }],
        });
    }
}

// --- Helpers ---

async function fetchActiveTasks(userId: string): Promise<Task[]> {
    // Fetch '未処理' and '進行中'
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['未処理', '進行中']);

    if (error || !data) return [];

    // Sort by Priority (S > A > B > C) then specific logic? 
    // User said: "sorted by Priority (S>A>B>C) then Created_at"

    return (data as Task[]).sort((a, b) => {
        const pA = priorityOrder[a.priority] ?? 3;
        const pB = priorityOrder[b.priority] ?? 3;
        if (pA !== pB) return pA - pB;
        // Date sort (ascending? older first usually for tasks, or newer? "Created_at" implies order. Usually FIFO)
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
}

function generateFlexMessage(tasks: Task[]) {
    // Colors
    const colors: Record<Priority, string> = {
        'S': '#FF3333', // Red
        'A': '#FF9933', // Orange
        'B': '#33CC33', // Green
        'C': '#3399FF', // Blue
    };

    const contents: any[] = tasks.map((task, index) => {
        const priorityColor = colors[task.priority] || '#000000';
        // Status icon/text
        const statusIcon = task.status === '進行中' ? '🏃' : ''; // '未処理' has no icon maybe, or just listed.
        // Example: "1. 📄 事業計画書 (🔥 S)"
        // Let's mimic the user example roughly
        const itemText = `${index + 1}. ${statusIcon} ${task.title}`;
        const metaText = `(${task.priority})`; // Or fire icon if S

        return {
            type: "box",
            layout: "horizontal",
            contents: [
                {
                    type: "text",
                    text: itemText,
                    flex: 4,
                    size: "sm",
                    color: "#333333",
                    wrap: true
                },
                {
                    type: "text",
                    text: metaText,
                    flex: 1,
                    size: "sm",
                    color: priorityColor,
                    align: "end",
                    weight: "bold"
                }
            ],
            margin: "md"
        };
    });

    return {
        type: "flex",
        altText: "Task Dashboard",
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "text",
                        text: "Task Dashboard",
                        weight: "bold",
                        size: "xl",
                        color: "#1DB446"
                    }
                ]
            },
            body: {
                type: "box",
                layout: "vertical",
                contents: contents.length > 0 ? contents : [
                    { type: "text", text: "No active tasks!", color: "#aaaaaa", align: "center" }
                ]
            },
            footer: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "text",
                        text: "Ex: '1 完了' to complete",
                        size: "xs",
                        color: "#aaaaaa",
                        align: "center"
                    }
                ]
            }
        }
    } as any;
}
