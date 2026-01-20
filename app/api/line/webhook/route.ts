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
    // Normalize: Full-width alphanumeric/spaces to half-width
    const normalizedText = text.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
        .replace(/　/g, " ")
        .trim();

    // 0. Global Commands
    if (normalizedText === "一覧" || normalizedText === "いちらん" || normalizedText.toLowerCase() === "list") {
        const tasks = await fetchActiveTasks(userId);
        const flexMessage = generateFlexMessage(userId, tasks);
        await client.replyMessage({ replyToken, messages: [flexMessage] });
        return;
    }

    if (normalizedText === "使い方" || normalizedText === "ヘルプ" || normalizedText.toLowerCase() === "help") {
        await client.replyMessage({
            replyToken,
            messages: [{
                type: "text",
                text: "【タスク自動整理の使い方】\n\n1. タスクの登録\n自由に送るだけでAIが登録します。改行して一気に入れてもOKです。\n\n2. ランク変更\n・「1 を S」: 1番をSランクへ\n\n3. 内容の修正\n・「1 を 〇〇 に修正」: タイトルを変更\n\n4. 状態の変更\n・「1 完了」「2 進行中」「3 削除」「4 保留」「2 は 削除」など。\n・「削除 2 3」のように複数を一度に消すことも可能です。\n\n「一覧」でリスト表示、「ダッシュボード」で管理画面リンクを表示します。"
            }],
        });
        return;
    }

    if (normalizedText === "ダッシュボード" || normalizedText === "管理画面" || normalizedText.toLowerCase() === "dashboard") {
        const dashboardUrl = `https://task-auto-sorting-app.vercel.app?u=${userId}`;
        await client.replyMessage({
            replyToken,
            messages: [{
                type: "flex",
                altText: "ダッシュボードを開く",
                contents: {
                    type: "bubble",
                    body: {
                        type: "box",
                        layout: "vertical",
                        contents: [
                            { type: "text", text: "あなた専用のダッシュボード", weight: "bold", size: "sm" },
                            {
                                type: "button",
                                action: { type: "uri", label: "管理画面を開く", uri: dashboardUrl },
                                style: "primary",
                                color: "#1DB446",
                                margin: "md"
                            }
                        ]
                    }
                }
            } as any],
        });
        return;
    }

    // 1. Parse Commands Systematically
    const lines = normalizedText.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const results: string[] = [];
    let processedCommands = 0;

    // Regex Definitions
    const editRegex = /^(\d+)\s*[はを]\s*(.+)\s*に修正$/;
    const priorityRegex = /^(\d+)\s*[はを]?\s*([SABC])\s*$/i;
    const statusEndRegex = /^(\d+)\s*[はを]?\s*(完了|削除|進行中|保留|静観|戻す)$/;
    const commandStartRegex = /^(完了|削除|進行中|保留|静観|戻す)\s*([\d\s]+)$/;

    const tasks = await fetchActiveTasks(userId);

    for (const line of lines) {
        // Try matching line as a command
        let match: any;

        // Pattern: "1 を 〇〇 に修正"
        if (match = line.match(editRegex)) {
            const idx = parseInt(match[1], 10);
            const title = match[2];
            if (tasks[idx - 1]) {
                await supabase.from('tasks').update({ title }).eq('id', tasks[idx - 1].id);
                results.push(`「${tasks[idx - 1].title}」→「${title}」`);
                processedCommands++;
                continue;
            }
        }

        // Pattern: "1 を S"
        if (match = line.match(priorityRegex)) {
            const idx = parseInt(match[1], 10);
            const priority = match[2].toUpperCase();
            if (tasks[idx - 1]) {
                await supabase.from('tasks').update({ priority, status: '未処理' }).eq('id', tasks[idx - 1].id);
                results.push(`「${tasks[idx - 1].title}」を ${priority}ランクに変更`);
                processedCommands++;
                continue;
            }
        }

        // Pattern: "1 完了" or "2 は 削除"
        if (match = line.match(statusEndRegex)) {
            const idx = parseInt(match[1], 10);
            const statusStr = match[2];
            const newStatus = statusStr === '削除' ? '削除済み' : (statusStr === '戻す' ? '未処理' : statusStr);
            if (tasks[idx - 1]) {
                await supabase.from('tasks').update({ status: newStatus }).eq('id', tasks[idx - 1].id);
                results.push(`「${tasks[idx - 1].title}」→ ${statusStr}`);
                processedCommands++;
                continue;
            }
        }

        // Pattern: "削除 2 3"
        if (match = line.match(commandStartRegex)) {
            const statusStr = match[1];
            const newStatus = statusStr === '削除' ? '削除済み' : (statusStr === '戻す' ? '未処理' : statusStr);
            const targetIndices = match[2].trim().split(/\s+/).filter(Boolean).map((n: string) => parseInt(n, 10));

            for (const idx of targetIndices) {
                if (tasks[idx - 1]) {
                    await supabase.from('tasks').update({ status: newStatus }).eq('id', tasks[idx - 1].id);
                    results.push(`「${tasks[idx - 1].title}」→ ${statusStr}`);
                    processedCommands++;
                }
            }
            continue;
        }
    }

    if (processedCommands > 0) {
        const updatedTasks = await fetchActiveTasks(userId);
        const flexMessage = generateFlexMessage(userId, updatedTasks);
        await client.replyMessage({
            replyToken,
            messages: [
                { type: "text", text: results.join("\n") },
                flexMessage
            ],
        });
        return;
    }

    // 2. Default: New Task Analysis (AI)
    // If it starts with a number but didn't match anything above, it's likely a typo
    if (/^\d+(\s|$)/.test(normalizedText)) {
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: "コマンドとして理解できませんでした。例：'1 完了' '2 を S' など" }],
        });
        return;
    }

    await handleNewTask(userId, replyToken, text.trim());
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
