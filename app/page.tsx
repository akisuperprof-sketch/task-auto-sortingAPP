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
  DragEndEvent,
  useDroppable,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function DashboardContent() {
  const searchParams = useSearchParams();
  const userIdFromUrl = searchParams.get('u');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [version, setVersion] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const now = new Date();
    const formatted = `${now.getFullYear().toString().slice(2)}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getDate().toString().padStart(2, '0')}.${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setVersion(formatted);
  }, []);

  const fetchTasks = async () => {
    if (!userIdFromUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userIdFromUrl)
      .order('created_at', { ascending: false });

    if (error) console.error('Error fetching tasks:', error);
    else setTasks(data as Task[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
    const onFocus = () => fetchTasks();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userIdFromUrl]);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('tasks').update({ status }).eq('id', id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: status as any } : t));
  };

  const updatePriority = async (id: string, priority: string) => {
    await supabase.from('tasks').update({ priority, status: '未処理' }).eq('id', id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: priority as any, status: '未処理' } : t));
  };

  const updateTitle = async (id: string, title: string) => {
    if (!title.trim()) return;
    await supabase.from('tasks').update({ title: title.trim() }).eq('id', id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, title: title.trim() } : t));
    setEditingId(null);
  };

  const deleteTaskPermanently = async (id: string) => {
    if (confirm('完全に削除しますか？')) {
      await supabase.from('tasks').delete().eq('id', id);
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const getActiveTasks = (priority: string) => tasks.filter(t => t.priority === priority && !['完了', '削除済み', '保留', '静観'].includes(t.status));

  const sTasks = getActiveTasks('S');
  const aTasks = getActiveTasks('A');
  const bTasks = getActiveTasks('B');
  const cTasks = getActiveTasks('C');
  const doneTasks = tasks.filter(t => t.status === '完了');
  const trashTasks = tasks.filter(t => t.status === '削除済み');
  const pendingTasks = tasks.filter(t => t.status === '保留');
  const watchTasks = tasks.filter(t => t.status === '静観');

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    const statusMap: Record<string, string> = {
      'done_zone': '完了',
      '完了': '完了',
      'trash_zone': '削除済み',
      '削除済み': '削除済み',
      'pending_zone': '保留',
      '保留': '保留',
      'watch_zone': '静観',
      '静観': '静観'
    };

    if (statusMap[overId]) {
      updateStatus(activeId, statusMap[overId]);
      return;
    } else if (['S', 'A', 'B', 'C'].includes(overId)) {
      updatePriority(activeId, overId);
      return;
    }

    const activeIndex = tasks.findIndex(t => t.id === activeId);
    const overIndex = tasks.findIndex(t => t.id === overId);

    if (activeIndex !== -1 && overIndex !== -1) {
      const activeTask = tasks[activeIndex];
      const overTask = tasks[overIndex];

      if (activeTask.priority !== overTask.priority || activeTask.status !== overTask.status) {
        const newPriority = overTask.priority;
        const newStatus = overTask.status;
        supabase.from('tasks').update({ priority: newPriority, status: newStatus }).eq('id', activeId).then(() => {
          setTasks((items) => {
            const list = [...items];
            list[activeIndex] = { ...activeTask, priority: newPriority as any, status: newStatus as any };
            return arrayMove(list, activeIndex, overIndex);
          });
        });
      } else {
        setTasks((items) => arrayMove(items, activeIndex, overIndex));
      }
    }
  };

  if (!userIdFromUrl) {
    return (
      <div className="min-h-screen bg-[#050608] flex items-center justify-center text-gray-500 font-sans text-xs uppercase tracking-widest">
        <div className="text-center space-y-2">
          <p>Access Denied</p>
          <p className="text-[10px] opacity-40 italic">Please access via LINE Dashboard link</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050608] text-gray-300 p-1 md:p-2 font-sans antialiased text-[10px] flex flex-col relative overflow-hidden">
      <header className="max-w-[2200px] w-full mx-auto flex justify-between items-center mb-1 px-1 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xs font-black tracking-tighter bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent uppercase">
            タスク自動整理 ver{version}
          </h1>
        </div>
        <button onClick={fetchTasks} className="p-1 hover:bg-white/5 rounded transition text-gray-700 hover:text-gray-400" disabled={loading}>
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="flex-1 flex gap-1 relative overflow-hidden">
          <main className="flex-1 grid grid-cols-4 gap-1 h-full">
            <DroppableColumn id="S" title="S: 重要+緊急" color="text-red-500" tasks={sTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} />
            <DroppableColumn id="A" title="A: 緊急のみ" color="text-amber-500" tasks={aTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} />
            <DroppableColumn id="B" title="B: 重要のみ" color="text-blue-500" tasks={bTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} />
            <DroppableColumn id="C" title="C: 低優先" color="text-emerald-500" tasks={cTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} />
          </main>

          <div className="flex flex-col gap-1 w-7 flex-shrink-0">
            <DropZoneStrip id="done_zone" icon={<CheckCircle2 size={12} />} active={showDone} onClick={() => { setShowDone(!showDone); setShowTrash(false); setShowPending(false); setShowWatch(false); }} color="text-emerald-600" count={doneTasks.length} label="完了" />
            <DropZoneStrip id="pending_zone" icon={<span className="text-[12px] leading-none mb-0.5">⏸️</span>} active={showPending} onClick={() => { setShowPending(!showPending); setShowDone(false); setShowTrash(false); setShowWatch(false); }} color="text-amber-600" count={pendingTasks.length} label="保留" />
            <DropZoneStrip id="watch_zone" icon={<span className="text-[12px] leading-none mb-0.5">👀</span>} active={showWatch} onClick={() => { setShowWatch(!showWatch); setShowDone(false); setShowTrash(false); setShowPending(false); }} color="text-blue-600" count={watchTasks.length} label="静観" />
            <DropZoneStrip id="trash_zone" icon={<Trash2 size={12} />} active={showTrash} onClick={() => { setShowTrash(!showTrash); setShowDone(false); setShowPending(false); setShowWatch(false); }} color="text-red-900" count={trashTasks.length} label="削除" />
          </div>

          {showDone && <SideDrawer id="完了" title="DONE" items={doneTasks} onClose={() => setShowDone(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}
          {showPending && <SideDrawer id="保留" title="PENDING" items={pendingTasks} onClose={() => setShowPending(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}
          {showWatch && <SideDrawer id="静観" title="WATCH" items={watchTasks} onClose={() => setShowWatch(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}
          {showTrash && <SideDrawer id="削除済み" title="TRASH" items={trashTasks} onClose={() => setShowTrash(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}
        </div>
      </DndContext>
    </div>
  );
}

function DroppableColumn({ id, title, color, tasks, editingId, editValue, setEditingId, setEditValue, updateTitle, updateStatus }: any) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={clsx("flex flex-col bg-white/[0.01] border rounded-sm overflow-hidden min-w-0 transition-colors", isOver ? "border-white/20 bg-white/[0.04]" : "border-white/[0.03]")}>
      <div className="flex items-center justify-between px-1 py-0.5 bg-white/[0.02] border-b border-white/[0.03]">
        <h2 className={clsx("text-[8px] font-black tracking-tighter", color)}>{title}</h2>
        <span className="text-[7px] font-mono text-gray-700">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t: any) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto p-0.5 space-y-0.5 scrollbar-hide min-h-[50px]">
          {tasks.map((task: any) => (
            <TaskItemCompact key={task.id} task={task} isEditing={editingId === task.id} editValue={editValue} onStartEdit={() => { setEditingId(task.id); setEditValue(task.title); }} onEditChange={setEditValue} onSaveEdit={() => updateTitle(task.id, editValue)} onCancelEdit={() => setEditingId(null)} onDone={() => updateStatus(task.id, '完了')} onDelete={() => updateStatus(task.id, '削除済み')} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

function DropZoneStrip({ id, icon, active, onClick, color, count, label }: any) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} onClick={onClick} className={clsx("flex-1 flex flex-col items-center justify-center border border-white/[0.05] rounded-sm transition-all cursor-pointer relative", active ? "bg-white/[0.08]" : "bg-white/[0.01] hover:bg-white/[0.04]", isOver && "border-white/20 bg-white/[0.12] scale-105 shadow-lg z-10")}>
      <div className={clsx(color, "flex flex-col items-center", active && "scale-110")}>
        {icon}
        <span className="text-[5px] font-black leading-none mt-0.5 opacity-50">{label}</span>
      </div>
      <span className="text-[6px] font-mono text-gray-700 mt-0.5">{count}</span>
    </div>
  );
}

function SideDrawer({ id, title, items, onClose, onDelete, onUpdateStatus }: any) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={clsx("absolute top-0 right-8 bottom-0 w-52 bg-[#0D0F13] border shadow-2xl z-20 flex flex-col rounded-sm transition-colors", isOver ? "border-white/30" : "border-white/10")}>
      <div className="flex items-center justify-between px-2 py-1 bg-white/[0.03] border-b border-white/10">
        <h2 className="text-[9px] font-black tracking-widest text-gray-500 uppercase">{title}</h2>
        <button onClick={onClose} className="text-gray-600 hover:text-white">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-1 space-y-1 scrollbar-hide">
        {items.map((task: any) => (
          <div key={task.id} className="p-1.5 bg-white/[0.02] border border-white/[0.04] rounded-[1px] group relative flex items-center justify-between gap-1 overflow-hidden">
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[6px] text-gray-700 font-bold uppercase truncate">{task.category}</span>
              <p className={clsx("text-[10px] truncate", task.status === '完了' ? "line-through text-gray-700" : "text-gray-500")}>{task.title}</p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100">
              <button onClick={() => onUpdateStatus(task.id, '未処理')} className="text-emerald-500/40 hover:text-emerald-400 p-0.5 border border-white/5 rounded" title="未処理に戻す"><RefreshCw size={8} /></button>
              <button onClick={() => onDelete(task.id)} className="text-red-900/40 hover:text-red-600 p-0.5 border border-white/5 rounded"><Trash2 size={8} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-center py-10 text-[8px] text-gray-800 uppercase italic">Empty</p>}
      </div>
    </div>
  );
}

function TaskItemCompact({ task, isEditing, editValue, onStartEdit, onEditChange, onSaveEdit, onCancelEdit, onDone, onDelete }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: isEditing });
  const isCompleted = task.status === '完了';
  const isInProgress = task.status === '進行中';

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }} className={clsx("group relative flex items-center justify-between gap-1 px-1 py-0.5 rounded-[1px] transition-colors border border-transparent", isCompleted ? "bg-transparent opacity-20" : "bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/[0.05]", isInProgress && "border-l-emerald-500/50 border-l-2 bg-emerald-500/[0.02]", isEditing && "bg-white/[0.08] border-white/[0.1] z-10")}>
      <div className="flex items-center gap-1 min-w-0 flex-1 h-full cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
        <span className="text-[6px] text-gray-700 font-bold uppercase truncate max-w-[20px] select-none">{isInProgress ? '🏃' : (task.category || '---')}</span>
        {isEditing ? (
          <input autoFocus className="flex-1 bg-transparent text-white outline-none font-medium leading-[1.1] tracking-tighter text-[10px] w-full" value={editValue} onChange={(e) => onEditChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }} onBlur={onSaveEdit} />
        ) : (
          <h3 onClick={(e) => { e.stopPropagation(); onStartEdit(); }} className={clsx("truncate font-medium leading-[1.1] tracking-tighter text-[10px] flex-1 cursor-text", isCompleted ? "line-through text-gray-700" : "text-gray-300")}>{task.title}</h3>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
        {!isCompleted && !isEditing && <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="text-emerald-500/40 hover:text-emerald-400 p-0.5"><CheckCircle2 size={8} /></button>}
        {!isEditing && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-500/20 hover:text-red-400 p-0.5"><Trash2 size={8} /></button>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050608]" />}>
      <DashboardContent />
    </Suspense>
  );
}
