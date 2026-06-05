import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Link2, Image as ImageIcon, ChevronDown, ChevronUp, Send,
  FileText, Paperclip, X, Eye, MousePointerClick, Mail, Server,
  Braces, Loader2, CheckCircle2, AlertCircle, Variable, Monitor,
  Smartphone, ChevronRight, Search, FileImage, FileType, File,
  UploadCloud, Trash2, Zap,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, token: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

type ComposeStatus = {
  gmail: { connected: boolean; email: string | null };
  smtp: { connected: boolean; email: string | null; fromName: string | null; mailboxId: number | null };
};

type Template = { id: number; name: string; subject: string; body: string };

type Attachment = {
  filename: string; content: string; contentType: string; size: number;
};

const VARIABLE_PLACEHOLDERS = [
  { label: "Name",     value: "{name}",     color: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700" },
  { label: "Vehicle",  value: "{vehicle}",  color: "bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700" },
  { label: "Pickup",   value: "{pickup}",   color: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700" },
  { label: "Delivery", value: "{delivery}", color: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700" },
  { label: "Price",    value: "{price}",    color: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700" },
  { label: "Quote ID", value: "{quote_id}", color: "bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600" },
  { label: "Company",  value: "{company}",  color: "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700" },
  { label: "Email",    value: "{email}",    color: "bg-pink-50 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-700" },
  { label: "Phone",    value: "{phone}",    color: "bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700" },
];

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "image/png": "PNG", "image/jpeg": "JPG", "image/gif": "GIF", "image/webp": "WEBP",
};

function formatFileSize(bytes: number) {
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function fileIcon(ct: string) {
  if (ct === "application/pdf") return <FileType className="h-4 w-4 text-red-500" />;
  if (ct.startsWith("image/")) return <FileImage className="h-4 w-4 text-blue-500" />;
  return <File className="h-4 w-4 text-slate-400" />;
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

function TBtn({ onClick, active, title, children }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={cn(
        "h-7 w-7 flex items-center justify-center rounded transition-colors",
        active
          ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-100"
      )}>
      {children}
    </button>
  );
}

function EditorToolbar({ editor, onImage }: { editor: Editor | null; onImage: () => void }) {
  if (!editor) return null;
  const setLink = () => {
    const url = window.prompt("Enter URL");
    if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-px px-3 py-2 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50">
      <TBtn title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
        <Bold className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
        <Italic className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")}>
        <UnderlineIcon className="h-3.5 w-3.5" />
      </TBtn>
      <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-1" />
      <TBtn title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
        <List className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
        <ListOrdered className="h-3.5 w-3.5" />
      </TBtn>
      <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-1" />
      <TBtn title="Insert link" onClick={setLink} active={editor.isActive("link")}>
        <Link2 className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn title="Insert image URL" onClick={onImage}>
        <ImageIcon className="h-3.5 w-3.5" />
      </TBtn>
    </div>
  );
}

// ─── Image dialog ─────────────────────────────────────────────────────────────

function ImageDialog({ open, onClose, onInsert }: {
  open: boolean; onClose: () => void; onInsert: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Insert Image</DialogTitle>
          <DialogDescription>Paste a public image URL to embed in the email.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <Input placeholder="https://example.com/image.png" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!url.trim()} onClick={() => { onInsert(url.trim()); setUrl(""); onClose(); }}>
              Insert
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
      ok
        ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
        : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-slate-400")} />
      {label}
    </span>
  );
}

// ─── Send-from selector ───────────────────────────────────────────────────────

function SendFromSelector({ status, value, onChange }: {
  status: ComposeStatus | undefined;
  value: "smtp" | "gmail" | "";
  onChange: (v: "smtp" | "gmail") => void;
}) {
  const options: { id: "smtp" | "gmail"; label: string; sub: string }[] = [];
  if (status?.smtp.connected) {
    options.push({
      id: "smtp",
      label: status.smtp.fromName ? `${status.smtp.fromName}` : (status.smtp.email ?? "SMTP Mailbox"),
      sub: status.smtp.email ?? "",
    });
  }
  if (status?.gmail.connected) {
    options.push({
      id: "gmail",
      label: "Gmail Account",
      sub: status.gmail.email ?? "",
    });
  }

  if (options.length === 0) return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/60">
      <Server className="h-4 w-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />
      <span className="text-sm text-slate-400 dark:text-slate-500 italic">No mailbox connected</span>
    </div>
  );

  return (
    <div className="flex items-start gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/60">
      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mt-2 w-8 flex-shrink-0">From</span>
      <div className="flex-1 flex flex-wrap gap-2 pt-1">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-all",
              value === opt.id
                ? "bg-blue-50 dark:bg-blue-900/25 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200"
                : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
            )}
          >
            {opt.id === "smtp" ? <Server className="h-3.5 w-3.5 flex-shrink-0" /> : <Mail className="h-3.5 w-3.5 flex-shrink-0" />}
            <span className="font-medium truncate max-w-[140px]">{opt.label}</span>
            {opt.sub && <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate hidden sm:inline max-w-[120px]">{opt.sub}</span>}
            {value === opt.id && <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0 ml-auto" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Recipient row ────────────────────────────────────────────────────────────

function RecipientRow({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/60 group">
      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide w-8 flex-shrink-0">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "email@example.com, another@example.com"}
        className="flex-1 bg-transparent outline-none text-sm text-slate-900 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 min-w-0"
      />
    </div>
  );
}

// ─── Drag-drop attachment zone ────────────────────────────────────────────────

function DragDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => fileRef.current?.click()}
      className={cn(
        "border-2 border-dashed rounded-lg px-4 py-5 flex flex-col items-center gap-2 cursor-pointer transition-all",
        dragging
          ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
          : "border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
      )}
    >
      <UploadCloud className={cn("h-8 w-8", dragging ? "text-blue-500" : "text-slate-300 dark:text-slate-600")} />
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 text-center">
        {dragging ? "Drop files here" : "Drag & drop or click to attach"}
      </p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">PDF, DOCX, Images · max 10 MB each</p>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.doc,.docx,image/*"
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
      />
    </div>
  );
}

// ─── Preview pane ─────────────────────────────────────────────────────────────

function PreviewPane({ html, subject, to }: { html: string; subject: string; to: string }) {
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewHtml = useMemo(() => {
    const body = html || "<p style='color:#94a3b8;font-family:sans-serif;text-align:center;padding:40px 0'>Write something to see a preview…</p>";
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b; background: #f8fafc; }
      a { color: #2563eb; }
      img { max-width: 100%; height: auto; }
      ul, ol { padding-left: 1.5em; }
    </style></head><body>${body}</body></html>`;
  }, [html]);

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (doc) { doc.open(); doc.write(previewHtml); doc.close(); }
  }, [previewHtml]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{subject || "No subject"}</p>
          {to && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">To: {to}</p>}
        </div>
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setMode("desktop")}
            className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all",
              mode === "desktop"
                ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            )}
          >
            <Monitor className="h-3.5 w-3.5" /> Desktop
          </button>
          <button
            type="button"
            onClick={() => setMode("mobile")}
            className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all",
              mode === "mobile"
                ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            )}
          >
            <Smartphone className="h-3.5 w-3.5" /> Mobile
          </button>
        </div>
      </div>
      <div className={cn(
        "flex-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden flex items-start justify-center p-4",
      )}>
        <div className={cn(
          "bg-white shadow-md rounded-lg overflow-hidden transition-all duration-300",
          mode === "desktop" ? "w-full max-w-2xl min-h-[400px]" : "w-[375px] min-h-[400px]"
        )}>
          <iframe
            ref={iframeRef}
            title="Email preview"
            className="w-full min-h-[400px] block border-0"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Right panel sections ─────────────────────────────────────────────────────

function PanelSection({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-500 dark:text-blue-400">{icon}</span>
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      {open && <div className="border-t border-slate-100 dark:border-slate-700/60">{children}</div>}
    </div>
  );
}

function TemplatesPanel({ token, onSelect }: {
  token: string; onSelect: (t: Template) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["templates-compose-panel"],
    queryFn: () => apiFetch("/api/templates", token),
    enabled: !!token,
  });

  const filtered = useMemo(() =>
    templates.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())),
    [templates, search]
  );

  return (
    <PanelSection title="Templates" icon={<FileText className="h-4 w-4" />}>
      <div className="p-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:border-blue-300 dark:focus:border-blue-600 text-slate-700 dark:text-slate-300 placeholder-slate-400"
          />
        </div>
        {isLoading ? (
          <div className="text-center py-4 text-slate-400 text-xs flex items-center justify-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-4 text-slate-400 dark:text-slate-500 text-xs">
            {search ? "No matching templates" : "No templates yet"}
          </div>
        ) : (
          <div className="space-y-1 max-h-52 overflow-y-auto pr-0.5">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t)}
                className="w-full text-left group px-3 py-2.5 rounded-lg border border-transparent hover:border-blue-200 dark:hover:border-blue-700 hover:bg-blue-50/60 dark:hover:bg-blue-900/20 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{t.name}</p>
                    {t.subject && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{t.subject}</p>}
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-500 flex-shrink-0 mt-0.5 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </PanelSection>
  );
}

function VariablesPanel({ onInsert }: { onInsert: (v: string) => void }) {
  return (
    <PanelSection title="Variables" icon={<Variable className="h-4 w-4" />}>
      <div className="p-3">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-2">Click to insert at cursor</p>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLE_PLACEHOLDERS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => onInsert(v.value)}
              title={`Insert ${v.value}`}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-mono font-medium transition-all hover:scale-105 active:scale-95",
                v.color
              )}
            >
              <Braces className="h-3 w-3 flex-shrink-0" />
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </PanelSection>
  );
}

function TrackingPanel({ openTracking, clickTracking, onOpenChange, onClickChange }: {
  openTracking: boolean; clickTracking: boolean;
  onOpenChange: (v: boolean) => void; onClickChange: (v: boolean) => void;
}) {
  return (
    <PanelSection title="Tracking" icon={<Zap className="h-4 w-4" />}>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-blue-500" /> Open Tracking
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Know when recipient opens</p>
          </div>
          <Switch checked={openTracking} onCheckedChange={onOpenChange} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <MousePointerClick className="h-3.5 w-3.5 text-violet-500" /> Click Tracking
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Track link clicks</p>
          </div>
          <Switch checked={clickTracking} onCheckedChange={onClickChange} />
        </div>
        {(openTracking || clickTracking) && (
          <p className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg px-2.5 py-2">
            Results appear in <strong>Sent Emails</strong> after sending.
          </p>
        )}
      </div>
    </PanelSection>
  );
}

function MailboxStatusPanel({ status }: { status: ComposeStatus | undefined }) {
  return (
    <PanelSection title="Mailbox Status" icon={<Server className="h-4 w-4" />} defaultOpen={false}>
      <div className="p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs text-slate-600 dark:text-slate-300">SMTP</span>
          </div>
          {status?.smtp.connected
            ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">{status.smtp.email}</span>
            : <span className="text-[11px] text-slate-400">Not connected</span>}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs text-slate-600 dark:text-slate-300">Gmail</span>
          </div>
          {status?.gmail.connected
            ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">{status.gmail.email}</span>
            : <span className="text-[11px] text-slate-400">Not connected</span>}
        </div>
        {!status?.smtp.connected && !status?.gmail.connected && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-lg px-2.5 py-2">
            Connect a mailbox in <strong>Mailbox Settings</strong> to send emails.
          </p>
        )}
      </div>
    </PanelSection>
  );
}

function AttachmentsPanel({ attachments, onAdd, onRemove }: {
  attachments: Attachment[];
  onAdd: (files: File[]) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <PanelSection title={`Attachments${attachments.length ? ` (${attachments.length})` : ""}`} icon={<Paperclip className="h-4 w-4" />} defaultOpen={false}>
      <div className="p-3 space-y-2">
        <DragDropZone onFiles={onAdd} />
        {attachments.length > 0 && (
          <div className="space-y-1.5 mt-1">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                {fileIcon(a.contentType)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{a.filename}</p>
                  <p className="text-[11px] text-slate-400">{formatFileSize(a.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelSection>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ComposeEmail() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<"compose" | "preview">("compose");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [openTracking, setOpenTracking] = useState(true);
  const [clickTracking, setClickTracking] = useState(true);
  const [sendFrom, setSendFrom] = useState<"smtp" | "gmail" | "">("");
  const [isSending, setIsSending] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);

  const { data: status } = useQuery<ComposeStatus>({
    queryKey: ["compose-status"],
    queryFn: () => apiFetch("/api/compose/status", token!),
    enabled: !!token,
  });

  // Auto-select first available mailbox
  useEffect(() => {
    if (!status || sendFrom) return;
    if (status.smtp.connected) setSendFrom("smtp");
    else if (status.gmail.connected) setSendFrom("gmail");
  }, [status, sendFrom]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: "Write your email here… Use variables like {name} or {vehicle} for personalization." }),
      TextStyle,
    ],
    editorProps: {
      attributes: {
        class: "min-h-[320px] p-4 outline-none prose prose-sm dark:prose-invert max-w-none text-slate-900 dark:text-slate-100 focus:outline-none",
      },
    },
  });

  const handleTemplateSelect = useCallback((template: Template) => {
    if (template.subject) setSubject(template.subject);
    if (editor && template.body) editor.commands.setContent(template.body);
    toast({ title: "Template loaded", description: `"${template.name}" inserted into composer.` });
  }, [editor, toast]);

  const handleInsertVariable = useCallback((variable: string) => {
    if (editor) editor.chain().focus().insertContent(variable).run();
  }, [editor]);

  const handleInsertImage = useCallback((url: string) => {
    if (editor) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const processFiles = useCallback((files: File[]) => {
    files.forEach((file) => {
      if (!ALLOWED_TYPES[file.type]) {
        toast({ title: "Unsupported file type", description: `${file.name} is not supported.`, variant: "destructive" });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: `${file.name} exceeds 10 MB.`, variant: "destructive" });
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        setAttachments((prev) => [...prev, { filename: file.name, content: base64, contentType: file.type, size: file.size }]);
      };
      reader.readAsDataURL(file);
    });
  }, [toast]);

  const validate = () => {
    if (!to.trim()) { toast({ title: "Recipient required", variant: "destructive" }); return false; }
    if (!subject.trim()) { toast({ title: "Subject required", variant: "destructive" }); return false; }
    if (!editor || editor.isEmpty) { toast({ title: "Body required", variant: "destructive" }); return false; }
    if (!sendFrom) { toast({ title: "Select a mailbox", description: "Choose which account to send from.", variant: "destructive" }); return false; }
    return true;
  };

  const handleSend = async () => {
    if (!validate() || !token) return;
    if (sendFrom === "gmail") { handleSaveDraft(); return; }
    setIsSending(true);
    try {
      await apiFetch("/api/compose/send", token, {
        method: "POST",
        body: JSON.stringify({
          to: to.trim(), cc: cc.trim() || undefined, bcc: bcc.trim() || undefined,
          subject: subject.trim(), htmlBody: editor!.getHTML(),
          openTracking, clickTracking, attachments,
        }),
      });
      toast({ title: "Email sent! ✓", description: `Delivered to ${to.trim()}` });
      handleReset();
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!validate() || !token) return;
    setIsSavingDraft(true);
    try {
      await apiFetch("/api/compose/draft", token, {
        method: "POST",
        body: JSON.stringify({
          to: to.trim() || undefined, cc: cc.trim() || undefined, bcc: bcc.trim() || undefined,
          subject: subject.trim(), htmlBody: editor!.getHTML(),
          openTracking, clickTracking,
        }),
      });
      toast({ title: "Saved to Gmail Drafts ✓", description: "Open Gmail to review before sending." });
      handleReset();
    } catch (err: any) {
      toast({ title: "Draft failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleReset = () => {
    setTo(""); setCc(""); setBcc(""); setSubject("");
    setShowCc(false); setShowBcc(false);
    setAttachments([]);
    if (editor) editor.commands.clearContent();
    setTab("compose");
  };

  const gmailConnected = status?.gmail.connected ?? false;
  const smtpConnected = status?.smtp.connected ?? false;
  const canSend = smtpConnected || gmailConnected;
  const busy = isSending || isSavingDraft;

  const primaryAction = sendFrom === "gmail"
    ? { label: "Save Gmail Draft", icon: <Mail className="h-4 w-4" />, onClick: handleSaveDraft, loading: isSavingDraft, style: "violet" as const }
    : { label: "Send Email", icon: <Send className="h-4 w-4" />, onClick: handleSend, loading: isSending, style: "blue" as const };

  return (
    <div className="space-y-5 pb-10">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Compose Email</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Create a personalized quote, follow-up, or carrier offer and send it instantly.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <StatusDot ok={smtpConnected} label={smtpConnected ? `SMTP · ${status?.smtp.email ?? "Connected"}` : "SMTP Not Connected"} />
            <StatusDot ok={gmailConnected} label={gmailConnected ? `Gmail · ${status?.gmail.email ?? "Connected"}` : "Gmail Not Connected"} />
            {(openTracking || clickTracking) && (
              <StatusDot ok label="Tracking On" />
            )}
          </div>
        </div>

        {/* Desktop send actions */}
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTab(tab === "preview" ? "compose" : "preview")}
            className="gap-1.5 h-9"
          >
            <Eye className="h-4 w-4" />
            {tab === "preview" ? "Edit" : "Preview"}
          </Button>
          {gmailConnected && sendFrom !== "smtp" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={handleSaveDraft}
              className="gap-1.5 h-9 border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20"
            >
              {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Save Draft
            </Button>
          )}
          {canSend && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={primaryAction.onClick}
              className={cn(
                "gap-1.5 h-9 font-semibold",
                primaryAction.style === "violet"
                  ? "bg-violet-600 hover:bg-violet-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              )}
            >
              {primaryAction.loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : primaryAction.icon}
              {primaryAction.label}
            </Button>
          )}
          {!canSend && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5" /> Connect a mailbox to send
            </div>
          )}
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">

        {/* ── Left: composer ── */}
        <div className="space-y-3">

          {/* Compose / Preview tabs */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
            {(["compose", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all",
                  tab === t
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                {t === "compose" ? "Compose" : "Preview"}
              </button>
            ))}
          </div>

          {tab === "compose" ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">

              {/* Send from selector */}
              <SendFromSelector status={status} value={sendFrom} onChange={setSendFrom} />

              {/* To */}
              <RecipientRow label="To" value={to} onChange={setTo} placeholder="recipient@example.com" />

              {/* CC/BCC toggle row */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-700/60">
                <span className="w-8 flex-shrink-0" />
                {[{ key: "cc", label: "CC", shown: showCc, toggle: () => setShowCc((v) => !v) },
                  { key: "bcc", label: "BCC", shown: showBcc, toggle: () => setShowBcc((v) => !v) },
                ].map(({ key, label, shown, toggle }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={toggle}
                    className={cn(
                      "flex items-center gap-0.5 text-xs px-2.5 py-1 rounded-full border transition-colors",
                      shown
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700"
                        : "text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:text-slate-600 hover:border-slate-300 dark:hover:border-slate-600"
                    )}
                  >
                    {shown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {label}
                  </button>
                ))}
              </div>

              {showCc && <RecipientRow label="CC" value={cc} onChange={setCc} placeholder="cc@example.com" />}
              {showBcc && <RecipientRow label="BCC" value={bcc} onChange={setBcc} placeholder="bcc@example.com" />}

              {/* Subject */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide w-8 flex-shrink-0">Subj</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject…"
                  className="flex-1 bg-transparent outline-none text-sm font-medium text-slate-900 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 min-w-0"
                />
              </div>

              {/* Editor toolbar */}
              <EditorToolbar editor={editor} onImage={() => setShowImageDialog(true)} />

              {/* Editor */}
              <EditorContent editor={editor} />

              {/* Bottom bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-800/40">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {attachments.length > 0
                    ? `${attachments.length} attachment${attachments.length > 1 ? "s" : ""}`
                    : "No attachments"}
                </p>
                {/* Mobile send actions */}
                <div className="flex items-center gap-2 sm:hidden">
                  {gmailConnected && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={handleSaveDraft}
                      className="h-8 text-xs gap-1.5 border-violet-200 text-violet-700">
                      {isSavingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                      Draft
                    </Button>
                  )}
                  {smtpConnected && (
                    <Button size="sm" disabled={busy} onClick={handleSend}
                      className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                      {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Send
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 min-h-[500px]">
              <PreviewPane html={editor?.getHTML() ?? ""} subject={subject} to={to} />
            </div>
          )}
        </div>

        {/* ── Right: tools panel ── */}
        <div className="space-y-3">
          <TemplatesPanel token={token!} onSelect={handleTemplateSelect} />
          <VariablesPanel onInsert={handleInsertVariable} />
          <TrackingPanel
            openTracking={openTracking}
            clickTracking={clickTracking}
            onOpenChange={setOpenTracking}
            onClickChange={setClickTracking}
          />
          <MailboxStatusPanel status={status} />
          <AttachmentsPanel
            attachments={attachments}
            onAdd={processFiles}
            onRemove={(i) => setAttachments((prev) => prev.filter((_, j) => j !== i))}
          />
        </div>
      </div>

      <ImageDialog
        open={showImageDialog}
        onClose={() => setShowImageDialog(false)}
        onInsert={handleInsertImage}
      />
    </div>
  );
}
