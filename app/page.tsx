"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient';
import { Task, Priority } from '@/types';
import { CheckCircle2, Trash2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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
    if (confirm('Delete permanently?')) {
      await supabase.from('tasks').delete().eq('id', id);
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeTask = tasks.find(t => t.id === active.id);
    const overId = over.id as string;

    // If dropped over a column header or an area representing a priority
    if (['S', 'A', 'B', 'C', '完了'].includes(overId)) {
      if (activeTask) {
        if (overId === '完了') {
          await updateStatus(activeTask.id, '完了');
        } else {
          // Move back from completed if necessary
          if (activeTask.status === '完了') {
            await supabase.from('tasks').update({ status: '未処理', priority: overId }).eq('id', activeTask.id);
            setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, status: '未処理', priority: overId as any } : t));
          } else {
            await updatePriority(activeTask.id, overId);
          }
        }
      }
    }

    setActiveId(null);
  };

  // Columns definition
  const columns: { id: string; title: string; color: string; items: Task[] }[] = [
    { id: 'S', title: 'S / Urgent', color: 'text-red-500', items: tasks.filter(t => t.priority === 'S' && t.status !== '完了') },
    { id: 'A', title: 'A / High', color: 'text-amber-500', items: tasks.filter(t => t.priority === 'A' && t.status !== '完了') },
    { id: 'B', title: 'B-C / Backlog', color: 'text-emerald-500', items: tasks.filter(t => ['B', 'C'].includes(t.priority) && t.status !== '完了') },
    { id: '完了', title: 'Completed', color: 'text-gray-500', items: tasks.filter(t => t.status === '完了') },
  ];

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <div className="min-h-screen bg-[#0A0C10] text-gray-200 p-2 md:p-3 font-sans antialiased text-[12px] selection:bg-cyan-500/30">
      <header className="max-w-[1800px] mx-auto flex justify-between items-center mb-3 px-1">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent uppercase">
            Task Monitor
          </h1>
          <div className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
        </div>

        <button
          onClick={fetchTasks}
          className="p-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/5 transition-all active:scale-95"
          disabled={loading}
        >
          <RefreshCw size={12} className={clsx("text-gray-500", loading && "animate-spin")} />
        </button>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <main className="max-w-[1800px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          {columns.map(col => (
            <div key={col.id} className="flex flex-col min-h-[200px]">
              <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-white/5">
                <h2 className={clsx("text-[10px] font-bold uppercase tracking-widest", col.color)}>{col.title}</h2>
                <span className="text-[9px] font-mono text-gray-600 bg-white/5 px-1.5 rounded-full">{col.items.length}</span>
              </div>

              <SortableContext items={col.items.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div className="flex-1 space-y-1 p-1 rounded-lg bg-white/[0.01] border border-transparent hover:border-white/[0.03] transition-colors min-h-[100px]">
                  {col.items.map(task => (
                    <SortableTaskItem
                      key={task.id}
                      task={task}
                      onDone={() => updateStatus(task.id, '完了')}
                      onDelete={() => deleteTask(task.id)}
                    />
                  ))}
                  {col.items.length === 0 && (
                    <div className="h-full flex items-center justify-center py-8 opacity-20 pointer-events-none">
                      <span className="text-[10px] uppercase font-bold tracking-tighter italic">Empty</span>
                    </div>
                  )}
                </div>
              </SortableContext>
            </div>
          ))}
        </main>

        <DragOverlay dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: {
              active: {
                opacity: '0.4',
              },
            },
          }),
        }}>
          {activeTask ? (
            <div className="p-2 rounded border bg-[#1A1D23] border-cyan-500/50 shadow-2xl scale-105 pointer-events-none">
              <span className="text-[8px] text-gray-500 font-bold uppercase mb-1 block">{activeTask.category}</span>
              <p className="text-[11px] font-medium text-white">{activeTask.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function SortableTaskItem({ task, onDone, onDelete }: {
  task: Task, onDone: () => void, onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const isCompleted = task.status === '完了';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        "group relative flex flex-col p-2 rounded border bg-[#121418] border-white/[0.05] hover:border-white/10 transition-all cursor-grab active:cursor-grabbing",
        isCompleted && "bg-transparent opacity-40"
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex justify-between items-center mb-0.5 pointer-events-none">
        <span className="text-[8px] text-gray-600 font-bold uppercase">{task.category || 'General'}</span>
        <div className="flex gap-2 pointer-events-auto">
          {!isCompleted && (
            <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="text-emerald-500/50 hover:text-emerald-400"><CheckCircle2 size={10} /></button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-500/40 hover:text-red-400"><Trash2 size={10} /></button>
        </div>
      </div>

      <p className={clsx(
        "font-medium leading-tight select-none",
        isCompleted ? "text-gray-600 line-through" : "text-gray-300"
      )}>
        {task.title}
      </p>
    </div>
  );
}
