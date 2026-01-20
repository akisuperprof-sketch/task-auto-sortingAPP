import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/utils/supabaseClient";

export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is 'not found'
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || { dev_rank_name: "自由設定（名前変更可能）" });
}

export async function POST(req: NextRequest) {
    try {
        const { userId, devRankName } = await req.json();
        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

        const { data, error } = await supabase
            .from('user_settings')
            .upsert({ user_id: userId, dev_rank_name: devRankName, updated_at: new Date().toISOString() })
            .select();

        if (error) throw error;
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
