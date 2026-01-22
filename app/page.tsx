"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient';
import { Task } from '@/types';
import { CheckCircle2, Trash2, RefreshCw, HelpCircle } from 'lucide-react';
import clsx from 'clsx';
import {
  DndContext,
  closestCenter,
  closestCorners,
  rectIntersection,
  pointerWithin,
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

const SYSTEM_VERSION = '26.01.22.20:01';

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
  const [showHelp, setShowHelp] = useState(false);
  const [version, setVersion] = useState('');
  const [newTaskValue, setNewTaskValue] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [devRankName, setDevRankName] = useState('自由設定（名前変更可能）');
  const [ideaRankName, setIdeaRankName] = useState('💡 アイデア（名前変更可能）');
  const [isEditingDevName, setIsEditingDevName] = useState(false);
  const [justAddedIds, setJustAddedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState<string>('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const customCollisionDetection = (args: any) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return closestCorners(args);
  };

  useEffect(() => {
    setVersion(SYSTEM_VERSION);

    // Show help on first visit
    const lastVersion = localStorage.getItem('help_shown_v1');
    if (!lastVersion) {
      setShowHelp(true);
      localStorage.setItem('help_shown_v1', 'true');
    }

    const savedDevName = localStorage.getItem('dev_rank_name');
    if (savedDevName) setDevRankName(savedDevName);
    const savedIdeaName = localStorage.getItem('idea_rank_name');
    if (savedIdeaName) setIdeaRankName(savedIdeaName);

    if (userIdFromUrl) {
      logAccess(userIdFromUrl, window.location.pathname);
      loadUserSettings(userIdFromUrl);
    }
  }, [userIdFromUrl]);

  const logAccess = (userId: string, path: string) => {
    fetch('/api/log-access', {
      method: 'POST',
      body: JSON.stringify({ userId, path }),
    }).catch(console.error);
  };

  const notifyError = (err: any, context: string) => {
    setError(`システムエラー発生: ${context}`);
    fetch('/api/notify-error', {
      method: 'POST',
      body: JSON.stringify({ error: err, context }),
    }).catch(console.error);
  };

  const loadUserSettings = async (userId: string) => {
    try {
      const res = await fetch(`/api/user-settings?userId=${userId}`);
      const data = await res.json();
      if (data.dev_rank_name) {
        setDevRankName(data.dev_rank_name);
        localStorage.setItem('dev_rank_name', data.dev_rank_name);
      }
      if (data.idea_rank_name) {
        setIdeaRankName(data.idea_rank_name);
        localStorage.setItem('idea_rank_name', data.idea_rank_name);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const saveDevName = async (newName: string) => {
    setDevRankName(newName);
    localStorage.setItem('dev_rank_name', newName);
    setIsEditingDevName(false);

    if (userIdFromUrl) {
      fetch('/api/user-settings', {
        method: 'POST',
        body: JSON.stringify({ userId: userIdFromUrl, devRankName: newName }),
      }).catch(console.error);
    }
  };

  const saveIdeaName = async (newName: string) => {
    setIdeaRankName(newName);
    localStorage.setItem('idea_rank_name', newName);
    if (userIdFromUrl) {
      fetch('/api/user-settings', {
        method: 'POST',
        body: JSON.stringify({ userId: userIdFromUrl, ideaRankName: newName }),
      }).catch(console.error);
    }
  };

  const fetchTasks = async () => {
    if (!userIdFromUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userIdFromUrl)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tasks:', error);
      notifyError(error, "タスク読み込み");
    } else {
      setTasks(data as Task[]);
      const now = new Date();
      setLastFetchedAt(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
    }
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

  const handleAddTask = async () => {
    if (!newTaskValue.trim() || !userIdFromUrl || isAdding) return;
    setIsAdding(true);
    try {
      // Use AI analysis similar to LINE bot to determine priority
      const response = await fetch('/api/tasks/analyze', {
        method: 'POST',
        body: JSON.stringify({ text: newTaskValue.trim() }),
      });
      const analyzed = await response.json();

      const toInsert = analyzed.map((t: any) => ({
        ...t,
        user_id: userIdFromUrl,
        status: '未処理'
      }));

      const { data, error: insertError } = await supabase.from('tasks').insert(toInsert).select();
      if (!insertError && data) {
        setTasks(prev => [...(data as Task[]), ...prev]);
        const ids = (data as Task[]).map(t => t.id);
        setJustAddedIds(ids);
        setTimeout(() => setJustAddedIds([]), 5000); // 5秒間ハイライト
        setNewTaskValue('');
      } else if (insertError) {
        throw insertError;
      }
    } catch (err) {
      console.error('Failed to add task:', err);
      notifyError(err, "タスク追加");
      // Fallback: add as IDEA if analysis fails
      const { data, error } = await supabase.from('tasks').insert([{
        title: newTaskValue.trim(),
        user_id: userIdFromUrl,
        priority: 'IDEA',
        status: '未処理',
        category: '手動入力'
      }]).select();
      if (!error && data) {
        setTasks(prev => [...(data as Task[]), ...prev]);
        setJustAddedIds([(data as Task[])[0].id]);
        setTimeout(() => setJustAddedIds([]), 5000);
        setNewTaskValue('');
      }
    } finally {
      setIsAdding(false);
    }
  };

  const getActiveTasks = (priority: string) => tasks.filter(t => t.priority === priority && !['完了', '削除済み', '保留', '静観'].includes(t.status));

  const applySearch = (items: Task[]) => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.map(t => ({
      ...t,
      isHiddenBySearch: !(t.title.toLowerCase().includes(q) || (t.category && t.category.toLowerCase().includes(q)))
    }));
  };

  const sTasks = applySearch(getActiveTasks('S'));
  const aTasks = applySearch(getActiveTasks('A'));
  const bTasks = applySearch(getActiveTasks('B'));
  const cTasks = applySearch(getActiveTasks('C'));
  const devTasks = applySearch(getActiveTasks('DEV'));
  const ideaTasks = applySearch(getActiveTasks('IDEA'));
  const doneTasks = applySearch(tasks.filter(t => t.status === '完了'));
  const trashTasks = applySearch(tasks.filter(t => t.status === '削除済み'));
  const pendingTasks = applySearch(tasks.filter(t => t.status === '保留'));
  const watchTasks = applySearch(tasks.filter(t => t.status === '静観'));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    const statusMap: Record<string, string> = {
      'done_zone': '完了',
      '完了': '完了',
      'progress_zone': '進行中',
      'dev_zone': '開発中',
      '開発中': '開発中',
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
    } else if (['S', 'A', 'B', 'C', 'DEV', 'IDEA'].includes(overId)) {
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
      <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center text-gray-500 font-sans p-4">
        <div className="max-w-xs w-full bg-white border border-gray-100 rounded-lg p-6 text-center space-y-4 shadow-xl">
          <div className="flex justify-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-400">
              <Trash2 size={24} />
            </div>
          </div>
          <h2 className="text-sm font-black tracking-widest uppercase text-gray-800">Access Denied</h2>
          <div className="space-y-2">
            <p className="text-[10px] leading-relaxed text-gray-500">
              セキュリティ保護のため、このページはLINEの「ダッシュボードを開く」リンクからのみアクセス可能です。
            </p>
            <div className="bg-gray-50 p-3 rounded text-[9px] text-left space-y-1 text-gray-400 italic">
              <p>解決方法：</p>
              <p>1. LINEボットに「一覧」と送信してください。</p>
              <p>2. 新しく届いたメッセージ内にあるリンクをタップして開いてください。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-[#F8F9FA] text-gray-800 p-1 md:p-2 font-sans antialiased text-[10px] relative overflow-hidden">
      <style jsx global>{`
        @keyframes flash {
          0% { background-color: rgba(16, 185, 129, 0.1); }
          50% { background-color: rgba(16, 185, 129, 0.2); }
          100% { background-color: transparent; }
        }
        .animate-flash-highlight {
          animation: flash 1.5s ease-in-out infinite;
        }
      `}</style>

      {/* Loading Overlay */}
      {loading && !tasks.length && (
        <div className="absolute inset-0 z-[60] bg-white/80 backdrop-blur-md flex flex-col items-center justify-center">
          <RefreshCw size={24} className="animate-spin text-emerald-500 mb-2" />
          <p className="text-[10px] text-emerald-500 font-black tracking-widest uppercase animate-pulse">SYSTEM LOADING...</p>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[70] bg-white border border-red-200 text-red-500 px-4 py-2 rounded shadow-xl flex items-center gap-2">
          <span className="text-xs font-black">!</span>
          <p className="text-[9px] font-bold">{error}</p>
          <button onClick={() => setError(null)} className="ml-2 hover:text-black">×</button>
        </div>
      )}

      <header className="max-w-[2200px] w-full mx-auto flex gap-2 md:gap-3 items-center mb-1 px-1 flex-shrink-0 h-6">
        <div className="flex items-center gap-2">
          <h1 className="text-[9px] md:text-[10px] font-black tracking-tighter text-gray-900 uppercase whitespace-nowrap">
            タスク自動整理 <span className="text-gray-400">ver{version}</span>
          </h1>
          {lastFetchedAt && (
            <span className="text-[7px] text-gray-400 font-mono tracking-tighter uppercase whitespace-nowrap bg-gray-100 px-1 rounded-sm">
              Sync: {lastFetchedAt}
            </span>
          )}
        </div>

        {/* Search & Add */}
        <div className="flex-1 flex gap-1 items-center">
          <div className="flex-1 flex items-center bg-gray-100/50 border border-gray-200 rounded px-2 h-5 focus-within:border-emerald-500/50 transition-colors">
            <span className="text-[8px] mr-1 opacity-40">🔍</span>
            <input
              type="text"
              placeholder="検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[9px] text-gray-900 placeholder-gray-400 h-full"
            />
            {searchQuery && <button onClick={() => setSearchQuery('')} className="text-[8px] text-gray-400 hover:text-gray-900">×</button>}
          </div>

          <div className="flex-[2] flex items-center bg-gray-100/50 border border-gray-200 rounded px-2 h-5 focus-within:border-emerald-500/50 transition-colors">
            <input
              type="text"
              placeholder="タスクを入力（AI解析）..."
              value={newTaskValue}
              onChange={(e) => setNewTaskValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              className="flex-1 bg-transparent outline-none text-[9px] text-gray-900 placeholder-gray-400 h-full"
              disabled={isAdding}
            />
            <button
              onClick={handleAddTask}
              disabled={isAdding || !newTaskValue.trim()}
              className={clsx("ml-1 transition-colors", newTaskValue.trim() ? "text-emerald-500" : "text-gray-300")}
            >
              {isAdding ? <RefreshCw size={10} className="animate-spin" /> : <span className="text-xs font-bold">+</span>}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => setShowHelp(true)} className="p-1 hover:bg-gray-100 rounded transition text-gray-400 hover:text-gray-600">
            <HelpCircle size={11} />
          </button>
          <button onClick={fetchTasks} className="p-1 hover:bg-gray-100 rounded transition text-gray-400 hover:text-gray-600" disabled={loading}>
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={customCollisionDetection} onDragEnd={onDragEnd}>
        <div className="flex-1 flex flex-col md:flex-row gap-1 relative overflow-hidden mb-14 md:mb-0">

          <main className="flex-1 grid grid-cols-2 md:grid-cols-6 gap-0.5 md:gap-1 h-full overflow-hidden">
            <DroppableColumn id="S" title="S: 重要+緊急" color="text-[#D32F2F]" bgColor="bg-[#FFF5F5]" borderColor="border-[#FFEBEE]" tasks={sTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} justAddedIds={justAddedIds} />
            <DroppableColumn id="A" title="A: 緊急のみ" color="text-[#F57C00]" bgColor="bg-[#FFF9F0]" borderColor="border-[#FFF3E0]" tasks={aTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} justAddedIds={justAddedIds} />
            <DroppableColumn id="B" title="B: 重要のみ" color="text-[#1976D2]" bgColor="bg-[#F0F7FF]" borderColor="border-[#E3F2FD]" tasks={bTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} justAddedIds={justAddedIds} />
            <DroppableColumn id="C" title="C: 低優先" color="text-[#388E3C]" bgColor="bg-[#F1F9F1]" borderColor="border-[#E8F5E9]" tasks={cTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} justAddedIds={justAddedIds} />
            <DroppableColumn id="DEV" title={devRankName} color="text-[#7B1FA2]" bgColor="bg-[#F9F4FC]" borderColor="border-[#F3E5F5]" tasks={devTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} isEditableTitle={true} onTitleSave={saveDevName} justAddedIds={justAddedIds} />
            <DroppableColumn id="IDEA" title={ideaRankName} color="text-[#C2185B]" bgColor="bg-[#FFF4F9]" borderColor="border-[#FCE4EC]" tasks={ideaTasks} editingId={editingId} editValue={editValue} setEditingId={setEditingId} setEditValue={setEditValue} updateTitle={updateTitle} updateStatus={updateStatus} isEditableTitle={true} onTitleSave={saveIdeaName} justAddedIds={justAddedIds} />
          </main>

          <div className="fixed bottom-0 left-0 right-0 h-14 bg-white/95 backdrop-blur-md border-t border-gray-100 flex md:relative md:flex-col md:w-8 md:h-full md:bg-transparent md:border-none md:bottom-auto md:left-auto md:right-auto md:gap-1 z-30 px-1 py-1 md:p-0">
            <DropZoneStrip id="done_zone" icon={<CheckCircle2 size={14} />} active={showDone} onClick={() => { setShowDone(!showDone); setShowTrash(false); setShowPending(false); setShowWatch(false); }} color="text-emerald-500" count={doneTasks.length} label="完了" />
            <DropZoneStrip id="progress_zone" icon={<span className="text-[14px]">🏃</span>} active={false} onClick={() => { }} color="text-cyan-500" count={tasks.filter(t => t.status === '進行中').length} label="進行" />
            <DropZoneStrip id="pending_zone" icon={<span className="text-[14px]">⏸️</span>} active={showPending} onClick={() => { setShowPending(!showPending); setShowDone(false); setShowTrash(false); setShowWatch(false); }} color="text-amber-500" count={pendingTasks.length} label="保留" />
            <DropZoneStrip id="watch_zone" icon={<span className="text-[14px]">👀</span>} active={showWatch} onClick={() => { setShowWatch(!showWatch); setShowDone(false); setShowTrash(false); setShowPending(false); }} color="text-blue-500" count={watchTasks.length} label="静観" />
            <DropZoneStrip id="trash_zone" icon={<Trash2 size={14} />} active={showTrash} onClick={() => { setShowTrash(!showTrash); setShowDone(false); setShowPending(false); setShowWatch(false); }} color="text-red-500" count={trashTasks.length} label="削除" />
          </div>

          {showDone && <SideDrawer id="完了" title="DONE" items={doneTasks} onClose={() => setShowDone(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}
          {showPending && <SideDrawer id="保留" title="PENDING" items={pendingTasks} onClose={() => setShowPending(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}
          {showWatch && <SideDrawer id="静観" title="WATCH" items={watchTasks} onClose={() => setShowWatch(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}
          {showTrash && <SideDrawer id="削除済み" title="TRASH" items={trashTasks} onClose={() => setShowTrash(false)} onDelete={deleteTaskPermanently} onUpdateStatus={updateStatus} />}

          {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        </div>
      </DndContext>
    </div>
  );
}

function DroppableColumn({ id, title, color, bgColor, borderColor, tasks, editingId, editValue, setEditingId, setEditValue, updateTitle, updateStatus, isEditableTitle, onTitleSave, justAddedIds }: any) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [headerValue, setHeaderValue] = useState(title);

  useEffect(() => {
    setHeaderValue(title);
  }, [title]);

  return (
    <section ref={setNodeRef} className={clsx("flex flex-col border rounded-lg overflow-hidden min-w-0 transition-all h-full shadow-sm", bgColor, borderColor, isOver ? "brightness-95 ring-1 ring-gray-200" : "")}>
      <div className="flex items-center justify-between px-2 py-1 bg-white/30 border-b border-inherit">
        {isEditableTitle && isEditingHeader ? (
          <input
            autoFocus
            className={clsx("text-[9px] font-black tracking-tighter bg-transparent outline-none w-full", color)}
            value={headerValue}
            onChange={(e) => setHeaderValue(e.target.value)}
            onBlur={() => { onTitleSave(headerValue); setIsEditingHeader(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onTitleSave(headerValue); setIsEditingHeader(false); }
              if (e.key === 'Escape') { setHeaderValue(title); setIsEditingHeader(false); }
            }}
          />
        ) : (
          <h2
            className={clsx("text-[9px] font-black tracking-tighter truncate cursor-pointer", color)}
            onClick={() => isEditableTitle && setIsEditingHeader(true)}
          >
            {title}
          </h2>
        )}
        <span className="text-[7px] font-mono font-bold text-gray-400">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t: any) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1 scrollbar-hide min-h-[50px]">
          {tasks.map((task: any) => (
            <TaskItemCompact key={task.id} task={task} isHidden={task.isHiddenBySearch} isNew={justAddedIds.includes(task.id)} isEditing={editingId === task.id} editValue={editValue} onStartEdit={() => { setEditingId(task.id); setEditValue(task.title); }} onEditChange={setEditValue} onSaveEdit={() => updateTitle(task.id, editValue)} onCancelEdit={() => setEditingId(null)} onDone={() => updateStatus(task.id, '完了')} onDelete={() => updateStatus(task.id, '削除済み')} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

function DropZoneStrip({ id, icon, active, onClick, color, count, label }: any) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} onClick={onClick} className={clsx("flex-1 flex flex-col items-center justify-center border border-gray-100 rounded-lg transition-all cursor-pointer relative", active ? "bg-gray-100" : "bg-white hover:bg-gray-50 shadow-sm", isOver && "border-emerald-200 bg-emerald-50 scale-105 shadow-md z-10")}>
      <div className={clsx(color, "flex flex-col items-center", active && "scale-110")}>
        {icon}
        <span className="text-[5px] font-black leading-none mt-0.5 opacity-60 uppercase">{label}</span>
      </div>
      <span className="text-[6px] font-mono font-bold text-gray-400 mt-0.5">{count}</span>
    </div>
  );
}

function SideDrawer({ id, title, items, onClose, onDelete, onUpdateStatus }: any) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={clsx("absolute top-0 right-0 left-0 bottom-14 md:bottom-0 md:left-auto md:right-8 md:w-64 bg-white border border-gray-200 shadow-2xl z-40 flex flex-col transition-all", isOver ? "ring-2 ring-emerald-100" : "")}>
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <h2 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-lg">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-hide">
        {items.map((task: any) => (
          <div key={task.id} className="p-2 bg-white border border-gray-100 rounded-md group relative flex items-center justify-between gap-2 shadow-sm">
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[6px] text-gray-400 font-bold uppercase truncate">{task.category}</span>
              <p className={clsx("text-[10px] font-medium truncate", task.status === '完了' ? "line-through text-gray-300" : "text-gray-700")}>{task.title}</p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onUpdateStatus(task.id, '未処理')} className="text-emerald-500 hover:bg-emerald-50 p-1 rounded transition-colors" title="未処理に戻す"><RefreshCw size={10} /></button>
              <button onClick={() => onDelete(task.id)} className="text-red-400 hover:bg-red-50 p-1 rounded transition-colors"><Trash2 size={10} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-center py-20 text-[8px] text-gray-300 uppercase italic font-bold">No tasks here</p>}
      </div>
    </div>
  );
}

function TaskItemCompact({ task, isEditing, editValue, onStartEdit, onEditChange, onSaveEdit, onCancelEdit, onDone, onDelete, isNew, isHidden }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: isEditing });
  const isCompleted = task.status === '完了';
  const isInProgress = task.status === '進行中';
  const isDev = task.priority === 'DEV';

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.3 : (isHidden ? 0.1 : 1) }} className={clsx("group relative flex items-center justify-between gap-1 px-2 py-1.5 rounded-md transition-all border", isCompleted ? "bg-transparent border-transparent opacity-40 shadow-none" : "bg-white border-gray-100 hover:border-gray-200 shadow-sm hover:shadow-md", isInProgress && "border-l-emerald-400 border-l-4", isEditing && "bg-white ring-2 ring-emerald-400/20 z-10 shadow-lg", isNew && "animate-flash-highlight bg-emerald-50 border-emerald-100")}>
      <div className="flex items-center gap-1.5 min-w-0 flex-1 h-full cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
        <span className="text-[7px] text-gray-400 font-bold uppercase truncate max-w-[24px] select-none">{isInProgress ? '🏃' : (isDev ? '🛠️' : (task.category || '---'))}</span>
        {isEditing ? (
          <input autoFocus className="flex-1 bg-transparent text-gray-900 outline-none font-semibold leading-[1.1] tracking-tighter text-[10px] w-full" value={editValue} onChange={(e) => onEditChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }} onBlur={onSaveEdit} />
        ) : (
          <h3 onClick={(e) => { e.stopPropagation(); onStartEdit(); }} className={clsx("line-clamp-2 overflow-hidden whitespace-normal font-semibold leading-[1.1] tracking-tighter text-[9.5px] flex-1 cursor-text", isCompleted ? "line-through text-gray-300" : "text-gray-800 hover:text-black")}>{task.title}</h3>
        )}
      </div>
      <div className="hidden md:flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
        {!isCompleted && !isEditing && <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="text-gray-300 hover:text-emerald-500 p-0.5 transition-colors"><CheckCircle2 size={10} /></button>}
        {!isEditing && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-gray-200 hover:text-red-400 p-0.5 transition-colors"><Trash2 size={10} /></button>}
      </div>
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-sm max-h-[85vh] overflow-y-auto shadow-2xl flex flex-col">
        <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-gray-100 px-5 py-4 flex justify-between items-center">
          <h2 className="text-xs font-black tracking-widest text-emerald-600 uppercase">タスク自動整理 使い方</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-8 text-[11px] leading-relaxed text-gray-600">
          <section className="space-y-3">
            <h3 className="text-[10px] font-black text-gray-900 border-l-4 border-emerald-500 pl-3 uppercase">LINE での操作</h3>
            <div className="space-y-4 pl-3">
              <div>
                <p className="text-gray-800 font-bold">1. タスクの登録</p>
                <p className="text-gray-400 italic mb-1">例：登録は「牛乳を買う」と送るだけ</p>
                <p>
                  送るだけでAIが自動判定。改行して送れば、<span className="text-emerald-600 font-bold">一括登録</span>も可能です。
                </p>
              </div>
              <div>
                <p className="text-gray-800 font-bold">2. タイトルの修正</p>
                <p className="text-gray-400 italic mb-1">例：修正は「1 を 〇〇会場に変更 に修正」</p>
                <p>番号を指定して書き換えられます。</p>
              </div>
              <div>
                <p className="text-gray-800 font-bold">3. ランク（優先度）変更</p>
                <p className="text-gray-400 italic mb-1">例：優先度は「2 を ランクAに修正」</p>
                <p>S / A / B / C / 開発 / メモ などを指定できます。</p>
              </div>
              <div>
                <p className="text-gray-800 font-bold">4. 完了・削除</p>
                <p className="text-gray-400 italic mb-1">例：削除は「1 削除」</p>
                <p>1 完了 / 1 削除 / 1 進行中 などの操作が可能です。</p>
              </div>
              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                <p className="text-emerald-700 font-bold mb-1">💡 ヒント</p>
                <p className="text-emerald-600/80 italic">全角の「２」や「Ｓ」も自動判定されるので、そのまま入力してOKです！</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[10px] font-black text-gray-900 border-l-4 border-cyan-500 pl-3 uppercase">ダッシュボード</h3>
            <div className="space-y-4 pl-3">
              <div>
                <p className="text-gray-800 font-bold text-[10px]">1. ランク移動（ドラッグ）</p>
                <p>タスクを掴んで別の列へ運ぶと優先度が変わります。</p>
              </div>
              <div>
                <p className="text-gray-800 font-bold text-[10px]">2. 状態の変更</p>
                <p>下部のアイコン（完了・保留など）へドロップすると状態が変わります。</p>
              </div>
            </div>
          </section>

          <button onClick={onClose} className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 rounded-xl transition-all shadow-lg hover:shadow-xl active:scale-[0.98]">
            了解しました
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8F9FA]" />}>
      <DashboardContent />
    </Suspense>
  );
}
