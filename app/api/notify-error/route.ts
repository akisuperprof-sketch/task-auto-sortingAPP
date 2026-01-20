import { NextRequest, NextResponse } from "next/server";
import * as line from "@line/bot-sdk";

const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
});

const ADMIN_ID = process.env.ADMIN_LINE_ID;

export async function POST(req: NextRequest) {
    try {
        const { error, context } = await req.json();

        if (ADMIN_ID) {
            await client.pushMessage({
                to: ADMIN_ID,
                messages: [{
                    type: "text",
                    text: `🚨システムエラー発生\nContext: ${context}\nError: ${JSON.stringify(error)}`
                }]
            });
        }

        return NextResponse.json({ message: "Notified" });
    } catch (err) {
        console.error("Notification error:", err);
        return NextResponse.json({ error: "Failed to notify" }, { status: 500 });
    }
}
