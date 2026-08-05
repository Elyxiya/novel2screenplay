export function EmptyState({ title, message }: { title?: string; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <div className="text-4xl mb-3">📭</div>
      <p className="font-medium">{title || '暂无数据'}</p>
      {message && <p className="text-sm mt-1">{message}</p>}
    </div>
  );
}
