export type Priority = 'S' | 'A' | 'B' | 'C' | 'DEV' | 'IDEA';
export type Status = '未処理' | '進行中' | '完了' | '保留' | '静観' | '戻す' | '削除済み';

export interface Task {
    id: string;
    user_id: string;
    title: string;
    category: string;
    priority: Priority;
    status: Status;
    created_at: string;
}
