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
                text: "【タスク自動整理の使い方】\n\n1. タスクの登録\n自由に送るだけでAIが登録します。改行して一気に入れてもOKです。\n\n2. ランク変更\n・「1 を S」: 1番をSランクへ\n\n3. 内容の修正\n・「1 を 〇〇 に修正」: タイトルを変更\n\n4. 状態の変更\n・「1 完了」「2 進行中」「3 開発中」「4 削除」「2 は 削除」など。\n・「削除 2 3」や「17と19を完了」のように複数を一度に操作することも可能です。\n\n「一覧」でリスト表示、「ダッシュボード」で管理画面リンクを表示します。"
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
    const commandResults: string[] = [];
    const taskLines: string[] = [];

    // Regex Definitions
    const statusWords = "完了|削除|進行中|開発中|保留|静観|戻す";
    const editRegex = /^(\d+)\s*[はを]\s*(.+)\s*に修正$/;
    const priorityRegex = /^(\d+)\s*[はを]?\s*([SABC])\s*$/i;
    const statusEndRegex = new RegExp(`^([\\d\\sと、,]+)\\s*[はを]?\\s*(${statusWords})$`);
    const commandStartRegex = new RegExp(`^(${statusWords})\\s*([\\d\\sと、,]+)$`);

    const tasks = await fetchActiveTasks(userId);

    for (const line of lines) {
        let match: any;

        if (match = line.match(editRegex)) {
            const idx = parseInt(match[1], 10);
            const title = match[2];
            if (tasks[idx - 1]) {
                await supabase.from('tasks').update({ title }).eq('id', tasks[idx - 1].id);
                commandResults.push(`✅修正: 「${tasks[idx - 1].title}」→「${title}」`);
                continue;
            }
        }

        if (match = line.match(priorityRegex)) {
            const idx = parseInt(match[1], 10);
            const priority = match[2].toUpperCase();
            if (tasks[idx - 1]) {
                await supabase.from('tasks').update({ priority, status: '未処理' }).eq('id', tasks[idx - 1].id);
                commandResults.push(`✅優先度: 「${tasks[idx - 1].title}」[${priority}]`);
                continue;
            }
        }

        if (match = line.match(statusEndRegex)) {
            const statusStr = match[2];
            const newStatus = statusStr === '削除' ? '削除済み' : (statusStr === '戻す' ? '未処理' : statusStr);
            const targetIndices = match[1].split(/[^\d]+/).filter(Boolean).map((n: string) => parseInt(n, 10));

            for (const idx of targetIndices) {
                if (tasks[idx - 1]) {
                    await supabase.from('tasks').update({ status: newStatus }).eq('id', tasks[idx - 1].id);
                    commandResults.push(`✅${statusStr}: 「${tasks[idx - 1].title}」`);
                }
            }
            continue;
        }

        if (match = line.match(commandStartRegex)) {
            const statusStr = match[1];
            const newStatus = statusStr === '削除' ? '削除済み' : (statusStr === '戻す' ? '未処理' : statusStr);
            const targetIndices = match[2].split(/[^\d]+/).filter(Boolean).map((n: string) => parseInt(n, 10));

            for (const idx of targetIndices) {
                if (tasks[idx - 1]) {
                    await supabase.from('tasks').update({ status: newStatus }).eq('id', tasks[idx - 1].id);
                    commandResults.push(`✅${statusStr}: 「${tasks[idx - 1].title}」`);
                }
            }
            continue;
        }

        if (/^\d+(\s|は|を|$)/.test(line)) {
            commandResults.push(`⚠️「${line}」はコマンドとして認識できませんでした。`);
        } else {
            taskLines.push(line);
        }
    }

    // 2. Finalize Results
    if (taskLines.length > 0) {
        const batchTasksText = taskLines.join("\n");
        const newTasks = await analyzeTasksWithAI(batchTasksText);

        if (newTasks.length > 0) {
            const { data: inserted, error: insertError } = await supabase
                .from('tasks')
                .insert(newTasks.map((t: any) => ({ ...t, user_id: userId })))
                .select();

            if (!insertError && inserted) {
                commandResults.push(`📝${inserted.length}件のタスクを追加しました。`);
            } else if (insertError) {
                console.error("Supabase insert error:", insertError);
                commandResults.push(`❌タスクの追加に失敗しました。`);
            }
        } else if (commandResults.length === 0) {
            commandResults.push(`⚠️「${batchTasksText}」からタスクを抽出できませんでした。`);
        }
    }

    if (commandResults.length > 0) {
        const updatedTasks = await fetchActiveTasks(userId);
        const flexMessage = generateFlexMessage(userId, updatedTasks);

        await client.replyMessage({
            replyToken,
            messages: [
                { type: "text", text: commandResults.join("\n") },
                flexMessage
            ],
        });
    } else {
        await client.replyMessage({
            replyToken,
            messages: [{ type: "text", text: `「${text}」が理解できませんでした。` }],
        });
    }
}

async function analyzeTasksWithAI(text: string) {
    const prompt = `以下のテキストからタスクを抽出してください。
テキスト:
"${text}"

解析ルール：
1. 原則として「1行1タスク」として扱ってください。
2. 「〇〇PJ 〇〇の状況」のように、プロジェクト名やコンテキストが含まれる場合は、それを含めてタスク名（title）にするか、適切にカテゴリ（category）に分類してください。
3. 各タスクの優先度（priority）を以下の基準で判定してください：
   - S: 重要かつ緊急（締め切り直近、重要会議、トラブル対応など）
   - A: 緊急（今日明日中にやるべきこと）
   - B: 重要（時間はかかるが重要な計画、準備など）
   - C: その他（日常的な雑務、急がないもの）

返信形式：
必ず以下のキーを持つJSON配列のみを返してください。余計な解説は不要です。
[{"title": "タスク名", "category": "カテゴリ", "priority": "S/A/B/C"}]`;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const match = responseText.match(/\[[\s\S]*\]/);
        if (!match) return [];
        return JSON.parse(match[0]);
    } catch (e) {
        console.error("AI Analysis error:", e);
        return [];
    }
}

async function fetchActiveTasks(userId: string): Promise<Task[]> {
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .not('status', 'eq', '削除済み')
        .not('status', 'eq', '完了');

    if (error || !data) return [];

    return (data as Task[]).sort((a, b) => {
        const pA = priorityOrder[a.priority] ?? 3;
        const pB = priorityOrder[b.priority] ?? 3;
        if (pA !== pB) return pA - pB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
}

function generateFlexMessage(userId: string, tasks: Task[]) {
    const colors: Record<Priority, string> = {
        'S': '#FF3333',
        'A': '#FF9933',
        'B': '#33CC33',
        'C': '#3399FF',
    };

    const contents: any[] = tasks.map((task, index) => {
        const priorityColor = colors[task.priority] || '#000000';
        const statusIcon = task.status === '進行中' ? '🏃' : (task.status === '開発中' ? '🛠️' : '');
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
                action: { type: "uri", label: "Dashboard", uri: dashboardUrl }
            },
            body: {
                type: "box",
                layout: "vertical",
                contents: contents.length > 0 ? contents : [
                    { type: "text", text: "未処理のタスクはありません", color: "#aaaaaa", align: "center", size: "sm" }
                ],
                action: { type: "uri", label: "Dashboard", uri: dashboardUrl }
            },
            footer: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
                    {
                        type: "button",
                        action: { type: "uri", label: "ダッシュボードを開く", uri: dashboardUrl },
                        style: "primary",
                        color: "#1DB446",
                        height: "sm"
                    },
                    {
                        type: "text",
                        text: "例: '1 完了' / '17と19を削除' / '1 を修正'",
                        size: "xxs",
                        color: "#aaaaaa",
                        align: "center"
                    }
                ]
            }
        }
    } as any;
}
