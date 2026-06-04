/** Sidebar — conversation list navigation. */

import { useConversations } from '../../hooks/useConversations';
import { useChatStore } from '../../store/chatStore';
import { formatDate, truncate } from '../../utils/format';

export default function Sidebar() {
  const { conversations, activeConversationId, loadConversation, deleteConversation } =
    useConversations();
  const newConversation = useChatStore((s) => s.newConversation);

  return (
    <aside className="w-64 bg-base-100 border-r border-base-300 flex flex-col h-full">
      <div className="p-3">
        <button
          className="btn btn-primary btn-sm w-full"
          onClick={newConversation}
        >
          + New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {conversations.length === 0 && (
          <p className="text-sm text-base-content/50 text-center py-8">
            No conversations yet
          </p>
        )}
        <ul className="menu menu-sm p-0">
          {conversations.map((conv) => (
            <li key={conv.id}>
              <a
                className={`flex justify-between items-start py-2 ${
                  activeConversationId === conv.id ? 'active' : ''
                }`}
                onClick={() => loadConversation(conv.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{truncate(conv.title, 30)}</div>
                  <div className="text-xs text-base-content/50">
                    {formatDate(conv.updated_at)} · {conv.message_count} msgs
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-xs text-error opacity-0 hover:opacity-100 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                >
                  ✕
                </button>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
