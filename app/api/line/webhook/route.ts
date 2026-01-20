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
    // Normalize: Full-width numbers/spaces to half-width
    const normalizedText = text.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, " ")
        .trim();

    // 0. Check for "一覧" command
    if (normalizedText === "一覧" || normalizedText === "いちらん" || normalizedText.toLowerCase() === "list") {
        const tasks = await fetchActiveTasks(userId);
        const flexMessage = generateFlexMessage(userId, tasks);
        await client.replyMessage({
            replyToken,
            messages: [flexMessage],
        });
        return;
    }

    // 1. Check for Modification Pattern: "1 は 打ち合わせ に修正"
    const editRegex = /^(\d+)\s*は\s*(.+)\s*に修正$/;
    const editMatch = normalizedText.match(editRegex);

    if (editMatch) {
        const displayIndex = parseInt(editMatch[1], 10);
        const newTitle = editMatch[2].trim();
        await handleTaskUpdateTitle(userId, replyToken, displayIndex, newTitle);
        return;
    }

    // 2. Check for Priority Change Pattern: "2 は S", "3 は B"
    const priorityRegex = /^(\d+)\s*は\s*([SABC])\s*$/i;
    const priorityMatch = normalizedText.match(priorityRegex);

    if (priorityMatch) {
        const displayIndex = parseInt(priorityMatch[1], 10);
        const newPriority = priorityMatch[2].toUpperCase() as Priority;
        await handlePriorityUpdate(userId, replyToken, displayIndex, newPriority);
        return;
    }

    // 3. Check for Status Update or Delete Pattern: "1 完了", "1 削除"
    const commandRegex = /^(\d+)\s*(完了|削除|進行中|保留|静観|戻す)$/;
    const commandMatch = normalizedText.match(commandRegex);

    if (commandMatch) {
        const displayIndex = parseInt(commandMatch[1], 10);
        const command = commandMatch[2];

        if (command === '削除') {
            await handleTaskUpdateStatus(userId, replyToken, displayIndex, '削除済み');
        } else {
            await handleTaskUpdateStatus(userId, replyToken, displayIndex, command as Status);
        }
    } else {
        // 4. Default: New Task Analysis
        await handleNewTask(userId, replyToken, text.trim());
    }
}

// --- Logic Handlers ---

async function handleTaskUpdateStatus(userId: string, replyToken: string, displayIndex: number, newStatus: Status) {
    // 1. Fetch current active tasks
    const tasks = await fetchActiveTasks(userId);

    if (displayIndex < 1 || displayIndex > tasks.length) {
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: `エラー: タスク ${displayIndex} 番は見つかりませんでした。` }],
        });
        return;
    }

    const targetTask = tasks[displayIndex - 1];

    // 2. Update Status
    const { error } = await supabase
        .from('tasks')
        .update({ status: newStatus })
        .eq('id', targetTask.id);

    if (error) {
        console.error("Supabase update error:", error);
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: "ステータスの更新に失敗しました。" }],
        });
        return;
    }

    // 3. Reply with success and updated list
    const updatedTasks = await fetchActiveTasks(userId);
    const flexMessage = generateFlexMessage(userId, updatedTasks);

    const message = newStatus === '削除済み'
        ? `タスク「${targetTask.title}」を削除しました。`
        : `タスク「${targetTask.title}」を「${newStatus}」に変更しました。`;

    await client.replyMessage({
        replyToken,
        messages: [
            { type: "text", text: message },
            flexMessage
        ],
    });
}

async function handlePriorityUpdate(userId: string, replyToken: string, displayIndex: number, newPriority: Priority) {
    const tasks = await fetchActiveTasks(userId);

    if (displayIndex < 1 || displayIndex > tasks.length) {
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: `エラー: タスク ${displayIndex} 番は見つかりませんでした。` }],
        });
        return;
    }

    const targetTask = tasks[displayIndex - 1];

    const { error } = await supabase
        .from('tasks')
        .update({ priority: newPriority })
        .eq('id', targetTask.id);

    if (error) {
        console.error("Supabase update error:", error);
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: "優先度の変更に失敗しました。" }],
        });
        return;
    }

    const updatedTasks = await fetchActiveTasks(userId);
    const flexMessage = generateFlexMessage(userId, updatedTasks);

    await client.replyMessage({
        replyToken,
        messages: [
            { type: "text", text: `タスク「${targetTask.title}」の優先度を「${newPriority}」に変更しました。` },
            flexMessage
        ],
    });
}

async function handleTaskUpdateTitle(userId: string, replyToken: string, displayIndex: number, newTitle: string) {
    const tasks = await fetchActiveTasks(userId);

    if (displayIndex < 1 || displayIndex > tasks.length) {
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: `エラー: タスク ${displayIndex} 番は見つかりませんでした。` }],
        });
        return;
    }

    const targetTask = tasks[displayIndex - 1];

    const { error } = await supabase
        .from('tasks')
        .update({ title: newTitle })
        .eq('id', targetTask.id);

    if (error) {
        console.error("Supabase update error:", error);
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: "修正に失敗しました。" }],
        });
        return;
    }

    const updatedTasks = await fetchActiveTasks(userId);
    const flexMessage = generateFlexMessage(userId, updatedTasks);

    await client.replyMessage({
        replyToken,
        messages: [
            { type: "text", text: `タスク「${targetTask.title}」を「${newTitle}」に修正しました。` },
            flexMessage
        ],
    });
}

async function handleNewTask(userId: string, replyToken: string, text: string) {
    // 1. Analyze with Gemini
    const prompt = `以下のテキストを解析し、タスクを抽出してください: "${text}"
    
    各タスクについて、以下の基準で優先度(priority)を判定してください：
    - S: 重要度も緊急度も高いもの
    - A: 緊急度が高いもの
    - B: 重要度が高いもの
    - C: 重要度も緊急度も低いもの
    
    返信は必ず以下のキーを持つJSON配列のみとしてください：
    "title" (タスク名), "category" (カテゴリ), "priority" (S, A, B, Cのいずれか)
    例: [{"title": "会議資料作成", "category": "仕事", "priority": "S"}]`;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        const match = responseText.match(/\[[\s\S]*\]/);
        if (!match) {
            throw new Error(`AI response did not contain JSON: ${responseText}`);
        }
        const cleanJson = match[0];
        const parsedTasks = JSON.parse(cleanJson);

        if (!Array.isArray(parsedTasks)) {
            throw new Error("Parsed as non-array");
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
            throw error;
        }

        // 3. Reply with Confirmation and Flex Message
        const tasks = await fetchActiveTasks(userId);
        const flexMessage = generateFlexMessage(userId, tasks);

        const addedTitles = dbTasks.map(t => `・${t.title} [${t.priority}]`).join("\n");

        await client.replyMessage({
            replyToken,
            messages: [
                { type: "text", text: `以下のタスクを登録しました：\n${addedTitles}` },
                flexMessage
            ],
        });

    } catch (err) {
        console.error("AI/Parsing Error:", err);
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: `「${text}」が理解できませんでした。` }],
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
        .not('status', 'eq', '削除済み')
        .not('status', 'eq', '完了');

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

function generateFlexMessage(userId: string, tasks: Task[]) {
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
        const itemText = `${index + 1}. ${statusIcon} ${task.title}`;
        const metaText = `(${task.priority})`;

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

    const dashboardUrl = `https://task-auto-sorting-app.vercel.app?u=${userId}`;

    return {
        type: "flex",
        altText: "タスク一覧",
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "text",
                        text: "📋 タスク一覧 (ダッシュボード)",
                        weight: "bold",
                        size: "md",
                        color: "#1DB446"
                    }
                ],
                action: {
                    type: "uri",
                    label: "Dashboard",
                    uri: dashboardUrl
                }
            },
            body: {
                type: "box",
                layout: "vertical",
                contents: contents.length > 0 ? contents : [
                    { type: "text", text: "未処理のタスクはありません", color: "#aaaaaa", align: "center", size: "sm" }
                ],
                action: {
                    type: "uri",
                    label: "Dashboard",
                    uri: dashboardUrl
                }
            },
            footer: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
                    {
                        type: "button",
                        action: {
                            type: "uri",
                            label: "ダッシュボードを開く",
                            uri: dashboardUrl
                        },
                        style: "primary",
                        color: "#1DB446",
                        height: "sm"
                    },
                    {
                        type: "text",
                        text: "例: '1 完了' / '1 削除' / '1 は 〇〇 に修正'",
                        size: "xxs",
                        color: "#aaaaaa",
                        align: "center"
                    }
                ]
            }
        }
    } as any;
}
