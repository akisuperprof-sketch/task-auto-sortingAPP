import { NextRequest, NextResponse } from "next/server";
import { model } from "@/utils/gemini";

export async function POST(req: NextRequest) {
    try {
        const { text } = await req.json();

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
   - DEV: 開発・コーディング・技術的な作業
   - IDEA: アイデア・メモ・思いつき

返信形式：
必ず以下のキーを持つJSON配列のみを返してください。余計な解説は不要です。
[{"title": "タスク名", "category": "カテゴリ", "priority": "S/A/B/C/DEV/IDEA"}]`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const match = responseText.match(/\[[\s\S]*\]/);

        if (!match) {
            return NextResponse.json([]);
        }

        return NextResponse.json(JSON.parse(match[0]));
    } catch (error) {
        console.error("AI Analysis error:", error);
        return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
    }
}
