/** Sidebar — conversation list navigation. */

import { useConversations } from '../../hooks/useConversations';
import { useChatStore } from '../../store/chatStore';
import { formatDate, truncate } from '../../utils/format';
import useT from '../../hooks/useT';

export default function Sidebar() {
  const { conversations, activeConversationId, loadConversation, deleteConversation } =
    useConversations();
  const newConversation = useChatStore((s) => s.newConversation);
  const t = useT();

  return (
    <aside className="w-64 bg-base-100 border-r border-base-300 flex flex-col h-full">
      <div className="p-3">
        <button
          className="btn btn-primary btn-sm w-full"
          onClick={newConversation}
        >
          {t('chat.newChat')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2">
        {conversations.length === 0 && (
          <p className="text-sm text-base-content/50 text-center py-8">
            {t('chat.noConversations')}
          </p>
        )}
        <ul className="menu menu-sm p-0 w-full">
          {conversations.map((conv) => (
            <li key={conv.id} className="overflow-hidden">
              <a
                className={`group !grid-cols-[minmax(0,1fr)] w-full min-w-0 overflow-hidden ${
                  activeConversationId === conv.id ? 'active' : ''
                }`}
                onClick={() => loadConversation(conv.id)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <span className="text-sm truncate">{truncate(conv.title, 20)}</span>
                  <span className="text-xs text-base-content/50 truncate">
                    {formatDate(conv.updated_at)} · {conv.message_count} {t('chat.msgs')}
                  </span>
                </div>
                <button
                  className="absolute right-1 top-1 btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity"
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
