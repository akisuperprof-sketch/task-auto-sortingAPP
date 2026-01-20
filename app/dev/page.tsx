"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient';
import { Task } from '@/types';
import { CheckCircle2, Trash2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Suspense } from 'react';

export default function DevDashboard() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState<string[]>([]);

    const fetchAllTasks = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching tasks:', error);
        } else {
            const allTasks = data as Task[];
            setTasks(allTasks);

            // Extract unique user IDs
            const uniqueUsers = Array.from(new Set(allTasks.map(t => t.user_id).filter(id => id)));
            setUsers(uniqueUsers);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchAllTasks();
    }, []);

    return (
        <div className="min-h-screen bg-[#020203] text-gray-400 p-4 font-sans antialiased text-[10px]">
            <header className="flex justify-between items-center mb-6 border-b border-white/5 pb-2">
                <div>
                    <h1 className="text-sm font-black tracking-tighter bg-gradient-to-r from-red-500 to-amber-500 bg-clip-text text-transparent uppercase">
                        Admin | 全ユーザー・タスク監視盤
                    </h1>
                    <p className="text-[8px] text-gray-600">Total Users: {users.length} | Total Tasks: {tasks.length}</p>
                </div>
                <button onClick={fetchAllTasks} className="p-2 hover:bg-white/5 rounded-full transition" disabled={loading}>
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                </button>
            </header>

            <div className="space-y-12">
                {users.map(userId => {
                    const userTasks = tasks.filter(t => t.user_id === userId);
                    const sTasks = userTasks.filter(t => t.priority === 'S' && t.status !== '完了' && t.status !== '削除済み');
                    const aTasks = userTasks.filter(t => t.priority === 'A' && t.status !== '完了' && t.status !== '削除済み');
                    const bTasks = userTasks.filter(t => t.priority === 'B' && t.status !== '完了' && t.status !== '削除済み');
                    const cTasks = userTasks.filter(t => t.priority === 'C' && t.status !== '完了' && t.status !== '削除済み');
                    const doneCount = userTasks.filter(t => t.status === '完了').length;

                    return (
                        <div key={userId} className="border border-white/10 rounded-lg p-3 bg-white/[0.01]">
                            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
                                <div className="flex items-center gap-3">
                                    <span className="bg-white/5 px-2 py-1 rounded text-[10px] font-mono text-cyan-500">USER: {userId}</span>
                                    <a
                                        href={`/?u=${userId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-gray-600 hover:text-white underline decoration-white/10 text-[8px]"
                                    >
                                        このユーザーのリンクを開く
                                    </a>
                                </div>
                                <div className="flex gap-4">
                                    <Stat label="ACTIVE" value={sTasks.length + aTasks.length + bTasks.length + cTasks.length} />
                                    <Stat label="DONE" value={doneCount} color="text-emerald-500" />
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                                <MiniColumn title="S" tasks={sTasks} color="text-red-500" />
                                <MiniColumn title="A" tasks={aTasks} color="text-amber-500" />
                                <MiniColumn title="B" tasks={bTasks} color="text-blue-500" />
                                <MiniColumn title="C" tasks={cTasks} color="text-emerald-500" />
                            </div>
                        </div>
                    );
                })}
            </div>

            {users.length === 0 && !loading && (
                <div className="h-64 flex items-center justify-center text-gray-700 italic">
                    No user data found.
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, color = "text-gray-500" }: any) {
    return (
        <div className="text-right">
            <p className="text-[6px] font-bold text-gray-700 tracking-widest leading-none">{label}</p>
            <p className={clsx("text-lg font-black leading-none mt-1", color)}>{value}</p>
        </div>
    );
}

function MiniColumn({ title, tasks, color }: any) {
    return (
        <div className="bg-black/40 rounded p-1 border border-white/[0.02]">
            <p className={clsx("text-[8px] font-black border-b border-white/5 mb-1 px-1", color)}>{title}</p>
            <div className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-hide">
                {tasks.map((t: any) => (
                    <div key={t.id} className="bg-white/[0.02] px-1 py-0.5 rounded-[1px] text-[8px] truncate text-gray-500">
                        {t.status === '進行中' && <span className="mr-1">🏃</span>}
                        {t.title}
                    </div>
                ))}
                {tasks.length === 0 && <p className="text-[6px] text-gray-800 text-center py-2 italic">-</p>}
            </div>
        </div>
    );
}
