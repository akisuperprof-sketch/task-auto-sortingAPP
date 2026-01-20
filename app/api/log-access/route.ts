import { NextRequest, NextResponse } from "next/server";
import * as line from "@line/bot-sdk";
import { supabase } from "@/utils/supabaseClient";

const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
});

const ADMIN_ID = process.env.ADMIN_LINE_ID;

export async function POST(req: NextRequest) {
    try {
        const { userId, path } = await req.json();

        // Log to DB
        await supabase.from('access_logs').insert([{ user_id: userId, path }]);

        // Notify Admin if someone else accesses /dev
        if (path.includes('/dev') && ADMIN_ID && userId !== ADMIN_ID) {
            await client.pushMessage({
                to: ADMIN_ID,
                messages: [{
                    type: "text",
                    text: `⚠️管理者画面へのアクセスを検知しました\nUser: ${userId || 'Unknown'}\nPath: ${path}`
                }]
            });
        }

        return NextResponse.json({ message: "Logged" });
    } catch (error) {
        console.error("Logging error:", error);
        return NextResponse.json({ error: "Failed to log" }, { status: 500 });
    }
}
