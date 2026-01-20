"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient';
import { Task } from '@/types';
import { CheckCircle2, Trash2, RefreshCw, Flame, Zap, Leaf } from 'lucide-react';
import clsx from 'clsx';

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch tasks from Supabase
  const fetchTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .neq('status', '完了') // Exclude completed tasks from main view
      .order('created_at', { ascending: true }); // Default sort by date

    if (error) {
      console.error('Error fetching tasks:', error);
    } else {
      setTasks(data as Task[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
    // Auto-refresh when window gains focus
    const onFocus = () => fetchTasks();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('tasks').update({ status }).eq('id', id);
    // Optimistic update or refetch
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const deleteTask = async (id: string) => {
    if (confirm('Permanently delete this task?')) {
      await supabase.from('tasks').delete().eq('id', id);
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  // Group tasks by priority
  const sTasks = tasks.filter(t => t.priority === 'S');
  const aTasks = tasks.filter(t => t.priority === 'A');
  const bcTasks = tasks.filter(t => ['B', 'C'].includes(t.priority));

  return (
    <div className="min-h-screen bg-[#0F1115] text-gray-100 p-4 md:p-8 font-sans selection:bg-green-500/30">
      <header className="max-w-7xl mx-auto flex justify-between items-center mb-10">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent">
            Task Dashboard
          </h1>
          <p className="text-gray-500 text-sm mt-1">AI-Powered Organization</p>
        </div>

        <button
          onClick={fetchTasks}
          className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition backdrop-blur-sm border border-white/5"
          disabled={loading}
        >
          <RefreshCw size={20} className={clsx("text-gray-400", loading && "animate-spin")} />
        </button>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">

        {/* Column 1: Red / Urgent (S) */}
        <div className="space-y-4">
          <SectionHeader
            title="Urgent"
            count={sTasks.length}
            icon={<Flame className="text-red-500 fill-red-500/20" />}
          />
          <div className="space-y-4">
            {sTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                accent="border-l-4 border-l-red-500"
                onDone={() => updateStatus(task.id, '完了')}
                onDelete={() => deleteTask(task.id)}
              />
            ))}
            {sTasks.length === 0 && <EmptyState />}
          </div>
        </div>

        {/* Column 2: Orange / High (A) */}
        <div className="space-y-4">
          <SectionHeader
            title="High Priority"
            count={aTasks.length}
            icon={<Zap className="text-amber-500 fill-amber-500/20" />}
          />
          <div className="space-y-4">
            {aTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                accent="border-l-4 border-l-amber-500"
                onDone={() => updateStatus(task.id, '完了')}
                onDelete={() => deleteTask(task.id)}
              />
            ))}
            {aTasks.length === 0 && <EmptyState />}
          </div>
        </div>

        {/* Column 3: Green/Blue / Backlog (B/C) */}
        <div className="space-y-4">
          <SectionHeader
            title="Backlog"
            count={bcTasks.length}
            icon={<Leaf className="text-emerald-500 fill-emerald-500/20" />}
          />
          <div className="space-y-3">
            {bcTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                compact
                accent="border-l-4 border-l-emerald-500"
                onDone={() => updateStatus(task.id, '完了')}
                onDelete={() => deleteTask(task.id)}
              />
            ))}
            {bcTasks.length === 0 && <EmptyState />}
          </div>
        </div>

      </main>
    </div>
  );
}

// Subcomponents

function SectionHeader({ title, count, icon }: { title: string, count: number, icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-1 mb-2">
      <div className="p-2 bg-white/5 rounded-lg border border-white/5 shadow-sm">
        {icon}
      </div>
      <h2 className="text-lg font-semibold tracking-wide text-gray-200">{title}</h2>
      <span className="ml-auto bg-white/10 text-gray-400 text-xs px-2 py-1 rounded-full">{count}</span>
    </div>
  );
}

function TaskCard({ task, accent, onDone, onDelete, compact }: {
  task: Task, accent: string, onDone: () => void, onDelete: () => void, compact?: boolean
}) {
  return (
    <div className={clsx(
      "group relative bg-[#15171C] hover:bg-[#1A1D23] transition-all duration-300 rounded-xl p-4 border border-white/5 shadow-sm hover:shadow-md hover:border-white/10",
      accent
    )}>
      {/* Category Badge */}
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold bg-white/5 px-2 py-0.5 rounded">
          {task.category || 'General'}
        </span>
        <span className={clsx("text-xs font-mono", compact ? "text-gray-600" : "text-gray-500")}>
          {new Date(task.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Title */}
      <h3 className={clsx(
        "font-medium text-gray-200 leading-snug pr-8",
        compact ? "text-sm" : "text-base"
      )}>
        {task.title}
      </h3>

      {/* Actions (Visible on hover on desktop, always visible on mobile?) 
          Let's align them bottom right or absolute top right 
      */}
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-white/5 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-lg transition"
        >
          <Trash2 size={14} /> Delete
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDone(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 rounded-lg transition"
        >
          <CheckCircle2 size={14} /> Done
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-white/10 rounded-xl p-6 text-center">
      <p className="text-gray-600 text-sm">No tasks in this section.</p>
    </div>
  );
}
