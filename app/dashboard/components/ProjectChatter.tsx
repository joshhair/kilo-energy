'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../../lib/context';
import { MessageSquare, Send, CheckSquare, RefreshCw, Calendar } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CheckItem {
  id: string;
  text: string;
  completed: boolean;
  completedBy?: string | null;
  completedByName?: string | null;
  dueDate?: string | null;
}

interface Mention {
  userId: string;
  userName: string;
  read: boolean;
}

interface ChatMessage {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string;
  authorRole: 'admin' | 'rep' | 'sub-dealer';
  text: string;
  checkItems: CheckItem[];
  mentions: Mention[];
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

const ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  admin:        { bg: 'bg-emerald-900/40', text: 'text-[var(--accent-green)]', label: 'Admin' },
  rep:          { bg: 'bg-blue-900/40',    text: 'text-[var(--accent-green)]',    label: 'Rep' },
  'sub-dealer': { bg: 'bg-amber-900/40',   text: 'text-amber-400',  label: 'Sub-Dealer' },
};

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isDueDateOverdue(iso: string): boolean {
  const due = new Date(iso);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

/** Parse `@Name` patterns and render highlighted spans.
 *  Matches only against known user names to avoid over-matching trailing words. */
function renderMessageText(text: string, knownNames: string[]): React.ReactNode[] {
  if (knownNames.length === 0) return [<span key={0}>{text}</span>];
  // Sort longest-first so multi-word names beat their sub-strings
  const escaped = [...knownNames]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(@(?:${escaped.join('|')}))`, 'g');
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="text-[var(--accent-green)] font-medium">{part}</span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── MentionDropdown ─────────────────────────────────────────────────────────

interface MentionDropdownProps {
  query: string;
  anchorRect: DOMRect | null;
  reps: Array<{ id: string; name: string }>;
  onSelect: (rep: { id: string; name: string }) => void;
  onClose: () => void;
  highlightIdx: number;
}

function MentionDropdown({ query, anchorRect, reps, onSelect, onClose: _onClose, highlightIdx }: MentionDropdownProps) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return reps.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, reps]);

  if (!anchorRect || filtered.length === 0) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchorRect.left,
    bottom: window.innerHeight - anchorRect.top + 4,
    zIndex: 9999,
    minWidth: 200,
    maxWidth: 280,
  };

  return createPortal(
    <div style={style} className="bg-[var(--surface-card)] border border-[var(--border)] rounded-xl shadow-2xl shadow-black/40 py-1 overflow-hidden">
      {filtered.map((rep, idx) => (
        <button
          key={rep.id}
          onMouseDown={(e) => { e.preventDefault(); onSelect(rep); }}
          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
            idx === highlightIdx ? 'bg-[var(--accent-green)]/20 text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--border)]/60 hover:text-white'
          }`}
        >
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/30 to-blue-700/30 flex items-center justify-center text-[10px] font-bold text-[var(--accent-cyan)] flex-shrink-0">
            {getInitials(rep.name)}
          </div>
          <span className="truncate">{rep.name}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

// ─── ProjectChatter ──────────────────────────────────────────────────────────

export default function ProjectChatter({ projectId }: { projectId: string }) {
  const { currentRepId, currentRepName, currentRole, reps, subDealers } = useApp();
  // Per-project mentionable user list, fetched from a dedicated
  // endpoint so vendor PMs (who have an empty reps[] in context)
  // can still tag people. Names only — not a contact directory.
  const [serverMentionable, setServerMentionable] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    fetch(`/api/projects/${projectId}/mentionable`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data)) setServerMentionable(data);
      })
      .catch(() => { /* fall back to context-built list below */ });
  }, [projectId]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [totalMessages, setTotalMessages] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const PAGE_SIZE = 30;

  // @mention state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIdx, setMentionStartIdx] = useState(-1);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionAnchor, setMentionAnchor] = useState<DOMRect | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Due date editing state
  const [editingDueDate, setEditingDueDate] = useState<{ messageId: string; checkItemId: string } | null>(null);

  // Build rep list for mentions. Prefer the server-scoped list when
  // loaded (vendor PM gets a narrowed list, internal users get the full
  // active set); fall back to the client context (reps + subDealers)
  // while the fetch is in flight so rendering doesn't flash empty.
  const mentionableUsers = useMemo(() => {
    if (serverMentionable) return serverMentionable;
    const users: Array<{ id: string; name: string }> = [];
    reps.filter((r) => r.active !== false).forEach((r) => users.push({ id: r.id, name: r.name }));
    subDealers.filter((sd) => sd.active !== false).forEach((sd) => users.push({ id: sd.id, name: `${sd.firstName} ${sd.lastName}` }));
    return users;
  }, [serverMentionable, reps, subDealers]);

  // Unread count for this project
  const unreadCount = useMemo(() => {
    return messages.reduce((count, msg) => {
      const mention = msg.mentions.find((m) => m.userId === currentRepId && !m.read);
      return count + (mention ? 1 : 0);
    }, 0);
  }, [messages, currentRepId]);

  // ── Fetch messages (paginated — loads last PAGE_SIZE by default) ────────────
  const fetchMessages = useCallback(() => {
    setLoading(true);
    // First get total to figure out offset for the last page
    fetch(`/api/projects/${projectId}/messages?limit=${PAGE_SIZE}&offset=0`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch messages');
        return res.json();
      })
      .then((data) => {
        const total = data.total ?? 0;
        setTotalMessages(total);
        if (total <= PAGE_SIZE) {
          setMessages(data.messages ?? []);
          return;
        }
        // Fetch the last PAGE_SIZE messages
        const offset = Math.max(total - PAGE_SIZE, 0);
        return fetch(`/api/projects/${projectId}/messages?limit=${PAGE_SIZE}&offset=${offset}`)
          .then((res) => res.json())
          .then((d) => {
            setTotalMessages(d.total ?? total);
            setMessages(d.messages ?? []);
          });
      })
      .catch(() => {
        setMessages([]);
        setTotalMessages(0);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  const loadEarlierMessages = useCallback(() => {
    const currentCount = messages.length;
    const remaining = totalMessages - currentCount;
    if (remaining <= 0) return;
    setLoadingEarlier(true);
    const fetchCount = Math.min(PAGE_SIZE, remaining);
    const offset = Math.max(remaining - fetchCount, 0);
    fetch(`/api/projects/${projectId}/messages?limit=${fetchCount}&offset=${offset}`)
      .then((res) => res.json())
      .then((data) => {
        const earlier = data.messages ?? [];
        setMessages((prev) => [...earlier, ...prev]);
        setTotalMessages(data.total ?? totalMessages);
      })
      .catch(() => {})
      .finally(() => setLoadingEarlier(false));
  }, [projectId, messages.length, totalMessages]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Auto-scroll to the latest message — only when the *last* message's id
  // changes (i.e. someone appended a new message). This intentionally does
  // NOT fire on:
  //   - Initial fetch (last id was undefined → now defined; we treat the
  //     first observation as a baseline, not a scroll trigger)
  //   - loadEarlierMessages prepends (last message id is unchanged because
  //     older messages get inserted at the front of the array)
  //
  // The previous attempts (initialLoadDone flag, count-grew check) all had
  // race conditions or false-positives. Tracking the *last id* is race-free
  // and semantically matches "did the user just send/receive a new message".
  // On mobile, scrolling here would otherwise pull the entire page down
  // because the chatter shares a scroll ancestor with the page (the layout
  // <main> element with overflow-y-auto).
  const lastMessageId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const newest = messages[messages.length - 1]?.id;
    const previous = lastMessageId.current;
    lastMessageId.current = newest;
    // Skip first observation — we're just recording the baseline.
    if (previous === undefined) return;
    if (newest === previous) return;
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages]);

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const trimmed = composeText.trim();
    if (!trimmed || sending) return;

    // Parse check items (lines starting with ☐ or [ ])
    const lines = trimmed.split('\n');
    const checkItems: Array<{ text: string }> = [];
    const textLines: string[] = [];
    for (const line of lines) {
      const checkMatch = line.match(/^(?:☐|☑|\[\s?\]|\[x\])\s*(.+)/i);
      if (checkMatch) {
        checkItems.push({ text: checkMatch[1].trim() });
      } else {
        textLines.push(line);
      }
    }

    // Parse @mentions — match known user names after @ symbol
    const mentionUserIds: string[] = [];
    const lowerText = trimmed.toLowerCase();
    for (const user of mentionableUsers) {
      const pattern = `@${user.name.toLowerCase()}`;
      if (lowerText.includes(pattern) && !mentionUserIds.includes(user.id)) {
        mentionUserIds.push(user.id);
      }
    }

    const messageText = textLines.join('\n').trim();

    setSending(true);

    // Optimistic local message
    const optimisticId = `temp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      projectId,
      authorId: currentRepId || 'admin',
      authorName: currentRepName || 'Admin',
      authorRole: (currentRole as 'admin' | 'rep' | 'sub-dealer') || 'admin',
      text: messageText,
      checkItems: checkItems.map((ci, idx) => ({
        id: `${optimisticId}-ci-${idx}`,
        text: ci.text,
        completed: false,
      })),
      mentions: mentionUserIds.map((uid) => {
        const u = mentionableUsers.find((u) => u.id === uid);
        return { userId: uid, userName: u?.name ?? '', read: false };
      }),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setComposeText('');

    fetch(`/api/projects/${projectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorId: currentRepId || 'admin',
        authorName: currentRepName || 'Admin',
        authorRole: currentRole || 'admin',
        text: messageText,
        checkItems,
        mentionUserIds,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to send');
        return res.json();
      })
      .then((saved) => {
        // Replace optimistic message with server version
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? saved : m))
        );
      })
      .catch(() => {
        // Keep optimistic message on failure (offline-friendly)
      })
      .finally(() => setSending(false));
  }, [composeText, sending, projectId, currentRepId, currentRepName, currentRole, mentionableUsers]);

  // ── Toggle check item ──────────────────────────────────────────────────────
  const toggleCheckItem = useCallback(
    (messageId: string, checkItemId: string, completed: boolean) => {
      // Optimistic update
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg;
          return {
            ...msg,
            checkItems: msg.checkItems.map((ci) =>
              ci.id === checkItemId
                ? { ...ci, completed, completedBy: completed ? currentRepId : null, completedByName: completed ? currentRepName : null }
                : ci
            ),
          };
        })
      );

      fetch(`/api/projects/${projectId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkItemId, completed, completedBy: currentRepId }),
      }).catch(() => {
        // Revert on failure
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            return {
              ...msg,
              checkItems: msg.checkItems.map((ci) =>
                ci.id === checkItemId ? { ...ci, completed: !completed, completedBy: null, completedByName: null } : ci
              ),
            };
          })
        );
      });
    },
    [projectId, currentRepId, currentRepName]
  );

  // ── Set due date on check item ──────────────────────────────────────────────
  const setCheckItemDueDate = useCallback(
    (messageId: string, checkItemId: string, dueDate: string | null) => {
      // Capture previous dueDate before optimistic update so we can restore on failure
      let previousDueDate: string | null = null;
      setMessages((prev) => {
        const msg = prev.find((m) => m.id === messageId);
        if (msg) {
          const ci = msg.checkItems.find((c) => c.id === checkItemId);
          if (ci) previousDueDate = ci.dueDate ?? null;
        }
        return prev.map((msg) => {
          if (msg.id !== messageId) return msg;
          return {
            ...msg,
            checkItems: msg.checkItems.map((ci) =>
              ci.id === checkItemId ? { ...ci, dueDate } : ci
            ),
          };
        });
      });
      setEditingDueDate(null);

      fetch(`/api/projects/${projectId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkItemId, dueDate }),
      }).catch(() => {
        // Revert on failure
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            return {
              ...msg,
              checkItems: msg.checkItems.map((ci) =>
                ci.id === checkItemId ? { ...ci, dueDate: previousDueDate } : ci
              ),
            };
          })
        );
      });
    },
    [projectId]
  );

  // ── @mention handling in textarea ──────────────────────────────────────────
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComposeText(val);

    const cursorPos = e.target.selectionStart;
    // Look backward from cursor for @ character
    const textBefore = val.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');

    if (atIdx !== -1) {
      const afterAt = textBefore.slice(atIdx + 1);
      // Only activate if there's no space before (start of line or preceded by space)
      const charBefore = atIdx > 0 ? val[atIdx - 1] : ' ';
      if ((charBefore === ' ' || charBefore === '\n' || atIdx === 0) && !/\n/.test(afterAt)) {
        setMentionActive(true);
        setMentionQuery(afterAt);
        setMentionStartIdx(atIdx);
        setMentionHighlight(0);

        // Calculate anchor position
        if (textareaRef.current) {
          const rect = textareaRef.current.getBoundingClientRect();
          setMentionAnchor(rect);
        }
        return;
      }
    }

    setMentionActive(false);
    setMentionQuery('');
  };

  const handleMentionSelect = (rep: { id: string; name: string }) => {
    const before = composeText.slice(0, mentionStartIdx);
    const after = composeText.slice(textareaRef.current?.selectionStart ?? composeText.length);
    const newText = `${before}@${rep.name} ${after}`;
    setComposeText(newText);
    setMentionActive(false);
    setMentionQuery('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive) {
      const filtered = mentionableUsers.filter((r) =>
        r.name.toLowerCase().includes(mentionQuery.toLowerCase())
      ).slice(0, 8);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionHighlight((h) => Math.min(h + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[mentionHighlight]) {
          e.preventDefault();
          handleMentionSelect(filtered[mentionHighlight]);
          return;
        }
      }
      if (e.key === 'Escape') {
        setMentionActive(false);
        return;
      }
    }

    // Cmd+Enter or Ctrl+Enter to send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Add checklist line ─────────────────────────────────────────────────────
  const addChecklistLine = () => {
    const suffix = composeText.endsWith('\n') || composeText === '' ? '' : '\n';
    setComposeText((prev) => `${prev}${suffix}\u2610 `);
    textareaRef.current?.focus();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="card-surface rounded-2xl p-6 mt-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-4 h-4 text-[var(--text-secondary)]" />
        <h2 className="text-white font-semibold">Chatter</h2>
        {unreadCount > 0 && (
          <span className="min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full text-[9px] font-bold leading-none text-white bg-[var(--accent-green)] shadow-sm shadow-blue-500/30">
            {unreadCount}
          </span>
        )}
        <span className="text-[var(--text-muted)] text-xs">({totalMessages})</span>
      </div>

      {/* Message List */}
      <div
        ref={scrollContainerRef}
        className="max-h-96 overflow-y-auto space-y-1 mb-4 pr-1 scrollbar-thin"
      >
        {/* Load earlier messages button */}
        {!loading && messages.length > 0 && messages.length < totalMessages && (
          <div className="text-center py-2">
            <button
              onClick={loadEarlierMessages}
              disabled={loadingEarlier}
              className="text-xs text-[var(--accent-green)] hover:text-[var(--accent-cyan)] font-medium transition-colors disabled:opacity-50"
            >
              {loadingEarlier ? (
                <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> Loading...</span>
              ) : (
                `Load earlier messages (${totalMessages - messages.length} more)`
              )}
            </button>
          </div>
        )}
        {loading && messages.length === 0 ? (
          <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm py-8 justify-center">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-8 h-8 text-[var(--text-dim)] mx-auto mb-2" />
            <p className="text-[var(--text-muted)] text-sm">No messages yet</p>
            <p className="text-[var(--text-dim)] text-xs mt-1">Start a conversation about this project</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isOwn = msg.authorId === currentRepId;
            const badge = ROLE_BADGE[msg.authorRole] ?? ROLE_BADGE.rep;
            return (
              <div
                key={msg.id}
                className={`rounded-xl p-4 transition-all animate-fade-in-up ${
                  isOwn ? 'bg-[var(--accent-green)]/[0.05] border border-[var(--accent-green)]/10' : 'bg-[var(--surface-card)]/40 border border-[var(--border-subtle)]/60'
                }`}
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
              >
                {/* Author row */}
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500/30 to-blue-700/30 flex items-center justify-center text-[10px] font-bold text-[var(--accent-cyan)] flex-shrink-0">
                    {getInitials(msg.authorName)}
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-white text-sm font-medium truncate">{msg.authorName}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  </div>
                  <span className="text-[var(--text-dim)] text-xs flex-shrink-0">{relativeTime(msg.createdAt)}</span>
                </div>

                {/* Message text */}
                <div className="text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-wrap pl-[38px]">
                  {renderMessageText(msg.text, mentionableUsers.map((u) => u.name))}
                </div>

                {/* Check items */}
                {msg.checkItems.length > 0 && (
                  <div className="mt-3 pl-[38px] space-y-1.5">
                    {msg.checkItems.map((ci) => {
                      const overdue = ci.dueDate && !ci.completed && isDueDateOverdue(ci.dueDate);
                      const isEditingThis = editingDueDate?.messageId === msg.id && editingDueDate?.checkItemId === ci.id;
                      return (
                        <div key={ci.id} className="flex items-center gap-2 group">
                          <input
                            type="checkbox"
                            checked={ci.completed}
                            onChange={() => toggleCheckItem(msg.id, ci.id, !ci.completed)}
                            className={`w-4 h-4 md:w-4 md:h-4 rounded border-[var(--border)] bg-[var(--surface-card)] focus:ring-offset-0 cursor-pointer flex-shrink-0 min-w-[20px] min-h-[20px] ${
                              ci.completed
                                ? 'text-[var(--accent-green)] focus:ring-emerald-500/30 accent-[var(--accent-green)]'
                                : 'text-[var(--accent-green)] focus:ring-[var(--accent-green)]/30 accent-[var(--accent-green)]'
                            }`}
                          />
                          <span className={`text-sm ${ci.completed ? 'text-[var(--text-muted)] line-through' : overdue ? 'text-red-300' : 'text-[var(--text-secondary)] group-hover:text-white'}`}>
                            {ci.text}
                          </span>
                          {ci.dueDate && !ci.completed && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                overdue
                                  ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                                  : 'bg-[var(--border)]/50 text-[var(--text-secondary)] border border-[var(--border)]/30'
                              }`}
                            >
                              {overdue ? 'Overdue' : `Due ${formatDueDate(ci.dueDate)}`}
                            </span>
                          )}
                          {ci.completed && ci.completedByName && (
                            <span className="text-[var(--text-dim)] text-[10px] ml-1 flex-shrink-0">
                              completed by {ci.completedByName}
                            </span>
                          )}
                          {/* Set/change due date — visible on hover for uncompleted items */}
                          {!ci.completed && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingDueDate(isEditingThis ? null : { messageId: msg.id, checkItemId: ci.id })}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--border)]/60 flex-shrink-0"
                                title="Set due date"
                              >
                                <Calendar className="w-3 h-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)]" />
                              </button>
                              {isEditingThis && (
                                <input
                                  type="date"
                                  defaultValue={ci.dueDate ? ci.dueDate.split('T')[0] : ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCheckItemDueDate(msg.id, ci.id, val || null);
                                  }}
                                  className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] text-xs rounded px-1.5 py-0.5 focus:outline-none focus:border-[var(--accent-green)] flex-shrink-0"
                                  autoFocus
                                  onBlur={() => setEditingDueDate(null)}
                                />
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose Area */}
      <div className="bg-[var(--surface-card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <textarea
          ref={textareaRef}
          value={composeText}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Write a message... Use @ to mention a rep"
          rows={3}
          className="w-full bg-transparent text-[var(--text-secondary)] text-sm placeholder:text-[var(--text-dim)] px-4 py-3 resize-none focus:outline-none"
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)]/60">
          <div className="flex items-center gap-1">
            <button
              onClick={addChecklistLine}
              title="Add checklist item"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:text-white hover:bg-[var(--border)]/60 transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Checklist Item</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[var(--text-dim)] text-[10px] hidden sm:inline">
              {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to send
            </span>
            <button
              onClick={handleSend}
              disabled={!composeText.trim() || sending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-110 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#050d18' }}
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </div>
      </div>

      {/* @mention dropdown */}
      {mentionActive && (
        <MentionDropdown
          query={mentionQuery}
          anchorRect={mentionAnchor}
          reps={mentionableUsers}
          onSelect={handleMentionSelect}
          onClose={() => setMentionActive(false)}
          highlightIdx={mentionHighlight}
        />
      )}
    </div>
  );
}
