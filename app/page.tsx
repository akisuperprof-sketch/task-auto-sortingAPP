"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient';
import { Task } from '@/types';
import { CheckCircle2, Trash2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) console.error('Error fetching tasks:', error);
    else setTasks(data as Task[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
    window.addEventListener('focus', fetchTasks);
    return () => window.removeEventListener('focus', fetchTasks);
  }, []);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('tasks').update({ status }).eq('id', id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: status as any } : t));
  };

  const updatePriority = async (id: string, priority: string) => {
    await supabase.from('tasks').update({ priority }).eq('id', id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: priority as any } : t));
  };

  const deleteTask = async (id: string) => {
    if (confirm('Delete?')) {
      await supabase.from('tasks').delete().eq('id', id);
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const sTasks = tasks.filter(t => t.priority === 'S' && t.status !== '完了');
  const aTasks = tasks.filter(t => t.priority === 'A' && t.status !== '完了');
  const bcTasks = tasks.filter(t => ['B', 'C'].includes(t.priority) && t.status !== '完了');
  const completedTasks = tasks.filter(t => t.status === '完了');

  return (
    <div className="min-h-screen bg-[#050608] text-gray-300 p-1 md:p-2 font-sans antialiased text-[10px]">
      <header className="max-w-[1900px] mx-auto flex justify-between items-center mb-1 px-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xs font-black tracking-tighter bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent uppercase">
            TM-OS
          </h1>
          <span className="text-[7px] text-gray-700 font-mono px-1 border border-white/5 rounded">v2.1.0</span>
        </div>

        <button
          onClick={fetchTasks}
          className="p-1 hover:bg-white/5 rounded transition text-gray-700 hover:text-gray-400"
          disabled={loading}
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => {
          const { active, over } = event;
          if (!over) return;
          const activeTask = tasks.find(t => t.id === active.id);
          const overId = over.id as string;
          if (!activeTask) return;

          if (overId === '完了') {
            updateStatus(activeTask.id, '完了');
          } else if (['S', 'A', 'B', 'C'].includes(overId)) {
            if (activeTask.status === '完了') {
              supabase.from('tasks').update({ status: '未処理', priority: overId }).eq('id', activeTask.id).then(() => {
                setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, status: '未処理', priority: overId as any } : t));
              });
            } else {
              updatePriority(activeTask.id, overId);
            }
          }
        }}
      >
        <main className="max-w-[2000px] mx-auto grid grid-cols-4 gap-1 h-[calc(100vh-30px)]">
          {[
            { id: 'S', title: 'S-URGENT', color: 'text-red-500', items: sTasks },
            { id: 'A', title: 'A-HIGH', color: 'text-amber-500', items: aTasks },
            { id: 'B', title: 'B/C-BACKLOG', color: 'text-emerald-500', items: bcTasks },
            { id: '完了', title: 'COMPLETED', color: 'text-gray-600', items: completedTasks }
          ].map(col => (
            <section key={col.id} id={col.id} className="flex flex-col bg-white/[0.01] border border-white/[0.03] rounded-sm overflow-hidden">
              <div className="flex items-center justify-between px-1 py-0.5 bg-white/[0.02] border-b border-white/[0.03]">
                <h2 className={clsx("text-[8px] font-black tracking-tighter", col.color)}>{col.title}</h2>
                <span className="text-[7px] font-mono text-gray-700">{col.items.length}</span>
              </div>

              <SortableContext items={col.items.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div className="flex-1 overflow-y-auto p-0.5 space-y-0.5 scrollbar-hide">
                  {col.items.map(task => (
                    <TaskItemCompact key={task.id} task={task} onDone={() => updateStatus(task.id, '完了')} onDelete={() => deleteTask(task.id)} />
                  ))}
                </div>
              </SortableContext>
            </section>
          ))}
        </main>
      </DndContext>
    </div>
  );
}

function TaskItemCompact({ task, onDone, onDelete }: { task: Task, onDone: () => void, onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const isCompleted = task.status === '完了';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes}
      {...listeners}
      className={clsx(
        "group relative flex items-center justify-between gap-1 px-1 py-0.5 rounded-[1px] transition-colors border border-transparent",
        isCompleted ? "bg-transparent opacity-20" : "bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.04]"
      )}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="text-[6px] text-gray-700 font-bold uppercase truncate max-w-[20px]">{task.category || '---'}</span>
        <h3 className={clsx("truncate font-medium leading-[1.1] tracking-tighter text-[10px]", isCompleted ? "line-through text-gray-700" : "text-gray-300")}>
          {task.title}
        </h3>
      </div>

      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isCompleted && <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="text-emerald-500/40 hover:text-emerald-400 p-0.5"><CheckCircle2 size={8} /></button>}
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-500/20 hover:text-red-400 p-0.5"><Trash2 size={8} /></button>
      </div>
    </div>
  );
}
