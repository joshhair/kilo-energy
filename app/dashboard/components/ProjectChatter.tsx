'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { useMediaQuery } from '../../../lib/hooks';
import { MessageSquare, Send, CheckSquare, RefreshCw, Calendar, Trash2, Search, Maximize2, X } from 'lucide-react';
import MobileBottomSheet from '../mobile/shared/MobileBottomSheet';

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

interface Reaction {
  userId: string;
  userName: string;
  reactionType: string;
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
  reactions?: Reaction[];
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
  admin:        { bg: 'bg-[var(--accent-emerald-soft)]', text: 'text-[var(--accent-emerald-text)]', label: 'Admin' },
  rep:          { bg: 'bg-[var(--accent-blue-soft)]',    text: 'text-[var(--accent-emerald-text)]',    label: 'Rep' },
  'sub-dealer': { bg: 'bg-[var(--accent-amber-soft)]',   text: 'text-[var(--accent-amber-text)]',  label: 'Sub-Dealer' },
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
        <span key={i} className="text-[var(--accent-emerald-text)] font-medium">{part}</span>
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
            idx === highlightIdx ? 'bg-[var(--accent-emerald-solid)]/20 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--border)]/60 hover:text-[var(--text-primary)]'
          }`}
        >
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/30 to-blue-700/30 flex items-center justify-center text-[10px] font-bold text-[var(--accent-cyan-text)] flex-shrink-0">
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
  const { toast } = useToast();
  // Mobile gets a MobileBottomSheet mention picker (tap-friendly) instead
  // of the cursor-anchored floating dropdown that's fiddly on touch.
  const isMobile = useMediaQuery('(max-width: 640px)');
  // Expanded mode: lifts the chatter into a full-viewport sheet via portal.
  // Embedded card stays mounted underneath for quick-glance; tap the expand
  // icon in the header to open, tap the X (or the backdrop) to collapse.
  const [expanded, setExpanded] = useState(false);
  // Lock the page scroll while the sheet is open so backgrounds don't drift
  // under the sticky composer on iOS Safari. Also listens for Escape to
  // close — matches the @mention picker + MobileBottomSheet keyboard story.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);
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
      .catch((err) => {
        console.warn('[ProjectChatter] fetch earlier messages failed:', err instanceof Error ? err.message : err);
      })
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
      .then(async (res) => {
        if (!res.ok) {
          // Capture server error detail so the user sees *why* it failed
          // (validation reason, 403, etc.) instead of the message just
          // appearing-then-vanishing on next refresh.
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) detail = body.error;
            else if (Array.isArray(body?.issues) && body.issues.length > 0) {
              detail = body.issues.map((i: { path: string; message: string }) => i.message).join(', ');
            }
          } catch { /* non-JSON response — keep HTTP code */ }
          throw new Error(detail);
        }
        return res.json();
      })
      .then((saved) => {
        // Replace optimistic message with server version
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? saved : m))
        );
      })
      .catch((err) => {
        // Surface the failure + roll back the optimistic message so the
        // user sees their compose text restored and a clear toast — no
        // more "looked saved but disappeared on refresh" silent fail.
        toast(err instanceof Error ? `Couldn't send: ${err.message}` : "Couldn't send message", 'error');
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setComposeText(messageText + (checkItems.length > 0 ? '\n' + checkItems.map((ci) => `☐ ${ci.text}`).join('\n') : ''));
      })
      .finally(() => setSending(false));
  }, [composeText, sending, projectId, currentRepId, currentRepName, currentRole, mentionableUsers, toast]);

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

  // ── Delete a message ───────────────────────────────────────────────────────
  // Allowed for the message's author + admin/PM. Optimistic remove with
  // confirm dialog (window.confirm — matches the inline-delete pattern
  // ProjectNotes uses; not worth a full modal for a chat row). On failure
  // we re-fetch from /messages so local state recovers without trying to
  // re-insert the row at the same index.
  const deleteMessage = useCallback(
    async (messageId: string) => {
      const ok = typeof window !== 'undefined' && window.confirm('Delete this message? This can\'t be undone.');
      if (!ok) return;
      const removed = messages.find((m) => m.id === messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      try {
        const res = await fetch(`/api/projects/${projectId}/messages/${messageId}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        toast('Message deleted', 'info');
      } catch (err) {
        // Revert: re-insert the removed row in its original slot.
        if (removed) {
          setMessages((prev) => {
            const arr = [...prev, removed];
            return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          });
        }
        toast(`Failed to delete: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      }
    },
    [messages, projectId, toast]
  );

  // ── Toggle reaction (👍 acknowledgement) ────────────────────────────────────
  // Optimistic: flip the local reactions array immediately, restore from
  // the server response (or roll back on error). Single reaction type for
  // v1 — the server clamps to 'like' regardless of what we send.
  const toggleReaction = useCallback(
    async (messageId: string) => {
      const repId = currentRepId;
      const repName = currentRepName ?? 'You';
      if (!repId) return; // shouldn't happen — chatter mounts only after auth
      // Snapshot the previous reactions for rollback. We do this OUTSIDE
      // the setMessages callback so the variable survives across renders.
      let prevReactions: Reaction[] | undefined;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const current = m.reactions ?? [];
          prevReactions = current;
          const has = current.some((r) => r.userId === repId && r.reactionType === 'like');
          const next = has
            ? current.filter((r) => !(r.userId === repId && r.reactionType === 'like'))
            : [...current, { userId: repId, userName: repName, reactionType: 'like' }];
          return { ...m, reactions: next };
        }),
      );
      try {
        const res = await fetch(`/api/projects/${projectId}/messages/${messageId}/react`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: { reacted: boolean; count: number; reactors: Reaction[] } = await res.json();
        // Sync local state to the server's authoritative reactor list.
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: body.reactors } : m)),
        );
      } catch (err) {
        // Rollback to the snapshot we captured.
        if (prevReactions !== undefined) {
          const snapshot = prevReactions;
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, reactions: snapshot } : m)),
          );
        }
        toast(`Reaction failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      }
    },
    [currentRepId, currentRepName, projectId, toast],
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

  // Cap the composer's auto-grown height to ~4 visible lines at 14px text
  // + 24px vertical padding before it switches to inner-scroll. Keeps the
  // mobile sticky-composer from eating the entire screen when someone
  // pastes a long message.
  const COMPOSER_MAX_HEIGHT_PX = 140;
  const autoGrowTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  };

  // Reset the composer height when the text empties (e.g., after send).
  useEffect(() => {
    if (composeText === '' && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [composeText]);

  // ── @mention handling in textarea ──────────────────────────────────────────
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComposeText(val);
    autoGrowTextarea(e.target);

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

  // Container layout swaps when expanded: a card with a capped scroll area
  // (embedded mode) → a fullscreen flex column with the message list growing
  // to fill the available viewport (sheet mode). The expanded panel adds
  // safe-area-inset-top padding so the X button clears the iPhone notch +
  // any browser chrome (URL bar bounce can otherwise cover the header).
  const outerClass = expanded
    ? 'fixed inset-0 z-50 bg-[var(--surface-page)] px-4 sm:px-6 pb-4 sm:pb-6 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pt-6 flex flex-col animate-modal-panel overflow-hidden'
    : 'card-surface rounded-2xl p-4 sm:p-6 mt-5';
  const messageListClass = expanded
    ? 'flex-1 overflow-y-auto space-y-2 mb-3 pr-1 scrollbar-thin scroll-pb-2'
    : 'max-h-[70vh] sm:max-h-[24rem] overflow-y-auto space-y-2 mb-4 pr-1 scrollbar-thin scroll-pb-2';

  const body = (
    <div className={outerClass}>
      {/* Header — sticky in expanded mode so the collapse X stays reachable
          even after scrolling far into history. In embedded mode the header
          scrolls naturally with the page. */}
      <div className={`flex items-center gap-2 mb-3 sm:mb-4 ${expanded ? 'shrink-0' : ''}`}>
        <MessageSquare className="w-4 h-4 text-[var(--text-secondary)]" />
        <h2 className="text-[var(--text-primary)] font-semibold">Chatter</h2>
        {unreadCount > 0 && (
          <span className="min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full text-[9px] font-bold leading-none text-[var(--text-primary)] bg-[var(--accent-emerald-solid)] shadow-sm shadow-blue-500/30">
            {unreadCount}
          </span>
        )}
        <span className="text-[var(--text-muted)] text-xs">({totalMessages})</span>
        {/* Expand / collapse — embedded → fullscreen sheet → embedded. Icon
            sits at the right edge of the header so the unread badge + count
            stay clustered with the title. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse chatter' : 'Expand chatter'}
          title={expanded ? 'Collapse' : 'Expand'}
          className="ml-auto p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40 active:scale-[0.94] transition-all min-w-[36px] min-h-[36px] flex items-center justify-center"
        >
          {expanded ? <X className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Message List — capped in embedded mode, flex-grows in sheet mode. */}
      <div
        ref={scrollContainerRef}
        className={messageListClass}
      >
        {/* Load earlier messages button */}
        {!loading && messages.length > 0 && messages.length < totalMessages && (
          <div className="text-center py-2">
            <button
              onClick={loadEarlierMessages}
              disabled={loadingEarlier}
              className="text-xs text-[var(--accent-emerald-text)] hover:text-[var(--accent-cyan-text)] font-medium transition-colors disabled:opacity-50"
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
            // Delete is allowed for: the author of the message, admins, and
            // project managers. Optimistic UI is implemented via deleteMessage().
            const canDelete = isOwn || currentRole === 'admin' || currentRole === 'project_manager';
            // Optimistic-row guard: a message with id starting with 'temp-'
            // is the optimistic placeholder we add before the server returns
            // the real id. Don't expose delete on it (the row swaps to the
            // real row a moment later anyway).
            const isOptimistic = msg.id.startsWith('temp-');
            return (
              <div
                key={msg.id}
                className={`group animate-fade-in-up flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
              >
                <div className={`relative max-w-[88%] sm:max-w-[80%] ${isOwn ? 'ml-auto' : 'mr-auto'}`}>
                  {/* Author row — hidden for own messages on mobile (implicit ownership via right-align + emerald);
                      always shown for others so you know who said it. Wraps cleanly on narrow viewports. */}
                  <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 mb-1 ${isOwn ? 'justify-end' : ''}`}>
                    {!isOwn && (
                      <>
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/30 to-blue-700/30 flex items-center justify-center text-[10px] font-bold text-[var(--accent-cyan-text)] flex-shrink-0">
                          {getInitials(msg.authorName)}
                        </div>
                        <span className="text-[var(--text-primary)] text-xs font-medium">{msg.authorName}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </>
                    )}
                    <span className="text-[var(--text-dim)] text-[11px] ml-auto">{relativeTime(msg.createdAt)}</span>
                    {canDelete && !isOptimistic && (
                      <button
                        type="button"
                        onClick={() => deleteMessage(msg.id)}
                        aria-label="Delete message"
                        title="Delete message"
                        className="flex-shrink-0 p-2 sm:p-1.5 rounded-md transition-all opacity-50 hover:opacity-100 focus-visible:opacity-100 active:scale-[0.92] hover:bg-[var(--accent-red-solid)]/10 min-w-[32px] min-h-[32px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-red-text)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Bubble — emerald for own (right), neutral card for others (left).
                      Rounded asymmetlically toward the conversation side per iMessage convention. */}
                  {(() => {
                    const myReacted = !!msg.reactions?.some((r) => r.userId === currentRepId && r.reactionType === 'like');
                    const reactionCount = msg.reactions?.length ?? 0;
                    const reactorTitle = reactionCount > 0
                      ? msg.reactions!.map((r) => r.userName).join(', ')
                      : 'Acknowledge this message';
                    return (
                  <>
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 ${
                      isOwn
                        ? 'bg-[var(--accent-emerald-soft)] border border-[var(--accent-emerald-solid)]/20 rounded-tr-md'
                        : 'bg-[var(--surface-card)]/70 border border-[var(--border-subtle)]/60 rounded-tl-md'
                    }`}
                  >
                    {/* Message text */}
                    <div className="text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {renderMessageText(msg.text, mentionableUsers.map((u) => u.name))}
                    </div>

                    {/* Check items — indented inside the bubble */}
                    {msg.checkItems.length > 0 && (
                      <div className="mt-2.5 space-y-1.5">
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
                                ? 'text-[var(--accent-emerald-text)] focus:ring-emerald-500/30 accent-[var(--accent-emerald-solid)]'
                                : 'text-[var(--accent-emerald-text)] focus:ring-[var(--accent-emerald-solid)]/30 accent-[var(--accent-emerald-solid)]'
                            }`}
                          />
                          <span className={`text-sm ${ci.completed ? 'text-[var(--text-muted)] line-through' : overdue ? 'text-[var(--accent-red-text)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'}`}>
                            {ci.text}
                          </span>
                          {ci.dueDate && !ci.completed && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                overdue
                                  ? 'bg-red-500/15 text-[var(--accent-red-text)] border border-red-500/20'
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
                                  className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] text-xs rounded px-1.5 py-0.5 focus:outline-none focus:border-[var(--accent-emerald-solid)] flex-shrink-0"
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
                  {/* Reaction row — 👍 toggle. Subtle when no one has reacted,
                      emerald-filled when the current user has. Title attribute
                      lists every reactor for hover/long-press peek. */}
                  {!msg.id.startsWith('temp-') && (
                    <div className={`mt-1 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                      <button
                        type="button"
                        onClick={() => toggleReaction(msg.id)}
                        title={reactorTitle}
                        aria-label={myReacted ? 'Remove your acknowledgement' : 'Acknowledge this message'}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-all active:scale-[0.94] min-h-[32px] min-w-[32px] justify-center ${
                          myReacted
                            ? 'bg-[var(--accent-emerald-soft)] border border-[var(--accent-emerald-solid)]/30 text-[var(--accent-emerald-text)]'
                            : 'bg-transparent border border-transparent text-[var(--text-dim)] hover:bg-[var(--accent-emerald-soft)]/40 hover:text-[var(--accent-emerald-text)]'
                        }`}
                      >
                        <span aria-hidden>👍</span>
                        {reactionCount > 0 && <span className="font-medium tabular-nums">{reactionCount}</span>}
                      </button>
                    </div>
                  )}
                  </>
                    );
                  })()}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose Area — pinned to the bottom of the card on mobile so the
          send action is always reachable while scrolling messages. Tightened
          significantly post-launch feedback (2026-05-22): textarea starts at
          1 row + auto-grow, toolbar shrunk, Send button icon-only on mobile
          to reduce the bar height ~60% (was eating half the viewport). The
          safe-area-inset padding clears the iPhone home indicator. */}
      <div className={`${expanded ? '' : 'sticky bottom-0'} -mx-4 sm:mx-0 -mb-4 sm:mb-0 px-4 sm:px-0 pb-[env(safe-area-inset-bottom)] sm:pb-0 bg-[var(--surface)] sm:bg-transparent border-t sm:border-t-0 border-[var(--border)]/60 pt-2 sm:pt-0`}>
        <div className="bg-[var(--surface-card)] border border-[var(--border)] rounded-xl overflow-hidden flex items-end gap-2 p-1.5 sm:p-0 sm:block">
          <textarea
            ref={textareaRef}
            value={composeText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Write a message... Use @ to mention a rep"
            rows={1}
            style={{ maxHeight: COMPOSER_MAX_HEIGHT_PX }}
            className="flex-1 min-w-0 bg-transparent text-[var(--text-secondary)] text-sm placeholder:text-[var(--text-dim)] px-2.5 py-2 sm:px-4 sm:py-3 resize-none focus:outline-none overflow-y-auto"
          />

          {/* Inline icon buttons on mobile (right of the textarea); desktop
              keeps the original full toolbar row beneath for the Cmd+Enter hint
              and the labeled Send button. */}
          <div className="flex items-center gap-1 shrink-0 sm:hidden">
            <button
              onClick={addChecklistLine}
              title="Add checklist item"
              aria-label="Add checklist item"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/60 active:scale-[0.94] transition-all"
            >
              <CheckSquare className="w-4 h-4" />
            </button>
            <button
              onClick={handleSend}
              disabled={!composeText.trim() || sending}
              aria-label="Send message"
              className="flex items-center justify-center w-10 h-10 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.94] transition-all"
              style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'var(--text-on-accent)' }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* Desktop toolbar — original layout with the labeled Add Checklist
              + Cmd+Enter hint + Send pill. Hidden on mobile because the inline
              icon row above replaces it. */}
          <div className="hidden sm:flex items-center justify-between px-3 py-2 border-t border-[var(--border)]/60">
            <div className="flex items-center gap-1">
              <button
                onClick={addChecklistLine}
                title="Add checklist item"
                aria-label="Add checklist item"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/60 transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>Add Checklist Item</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[var(--text-dim)] text-[10px]">
                {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to send
              </span>
              <button
                onClick={handleSend}
                disabled={!composeText.trim() || sending}
                aria-label="Send message"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-110 active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'var(--text-on-accent)' }}
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* @mention picker — bottom-sheet on mobile (tap to pick), cursor-
          anchored floating popover on desktop (arrow keys + Enter). */}
      {mentionActive && isMobile && (
        <MobileBottomSheet open={mentionActive} onClose={() => setMentionActive(false)} title="Mention a teammate">
          <div className="px-5 pb-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} aria-hidden />
              <input
                type="text"
                value={mentionQuery}
                onChange={(e) => setMentionQuery(e.target.value)}
                placeholder="Search names…"
                autoFocus
                className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--accent-emerald-solid)]"
              />
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {mentionableUsers
              .filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
              .slice(0, 20)
              .map((u) => (
                <MobileBottomSheet.Item
                  key={u.id}
                  label={u.name}
                  onTap={() => handleMentionSelect(u)}
                />
              ))}
          </div>
        </MobileBottomSheet>
      )}
      {mentionActive && !isMobile && (
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

  // In sheet mode, render via portal above everything with a backdrop the
  // user can tap to dismiss. createPortal anchors to document.body so the
  // fixed-inset-0 panel ignores any ancestor transform/overflow context.
  if (expanded && typeof document !== 'undefined') {
    return createPortal(
      <>
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-modal-backdrop"
          onClick={() => setExpanded(false)}
          aria-hidden
        />
        {body}
      </>,
      document.body,
    );
  }
  return body;
}
