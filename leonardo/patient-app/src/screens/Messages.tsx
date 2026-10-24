// Text chat with physicians who accepted the patient's request.
import { Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getLinks, getMessages, getPhysician, sendMessage, useDataChanges } from '../api';
import { Initials } from '../components/Layout';
import type { Physician } from '../types';

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

export function Messages() {
  useDataChanges();
  const [params, setParams] = useSearchParams();
  const links = getLinks();
  const doctors = links
    .map((l) => ({ link: l, doc: getPhysician(l.physician_id) }))
    .filter((x): x is { link: typeof x.link; doc: Physician } => !!x.doc);
  const connected = doctors.filter((d) => d.link.status === 'accepted');
  const selectedId = params.get('to') ?? connected[0]?.doc.id;
  const selected = connected.find((d) => d.doc.id === selectedId)?.doc ?? connected[0]?.doc;

  if (!connected.length) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-xl">
        <p>You can message a physician once they accept your request.</p>
        <Link to="/patient/settings" className="mt-4 inline-flex min-h-[56px] items-center rounded-xl bg-neutral-100 px-6 font-semibold text-neutral-950">
          Add a physician
        </Link>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-200px)] min-h-[520px] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 md:grid-cols-[300px_1fr]">
      <aside className="border-b border-neutral-800 md:border-b-0 md:border-r">
        <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col">
          {doctors.map(({ link, doc }) => {
            const accepted = link.status === 'accepted';
            const last = accepted ? getMessages(doc.id).slice(-1)[0] : undefined;
            return (
              <li key={doc.id} className="shrink-0">
                <button
                  disabled={!accepted}
                  onClick={() => setParams({ to: doc.id })}
                  className={`flex min-h-[72px] w-full items-center gap-3 rounded-xl px-3 text-left ${
                    selected?.id === doc.id ? 'bg-neutral-800' : 'hover:bg-neutral-800/60'
                  } disabled:opacity-50`}
                >
                  <Initials name={doc.name} />
                  <div className="min-w-0">
                    <div className="truncate text-lg font-medium">{doc.name}</div>
                    <div className="truncate text-base text-neutral-400">{accepted ? (last?.text ?? doc.role) : 'Waiting to accept'}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      {selected && <Conversation doc={selected} />}
    </div>
  );
}

function Conversation({ doc }: { doc: Physician }) {
  const messages = getMessages(doc.id);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, doc.id]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendMessage(doc.id, t);
    setText('');
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
        <Initials name={doc.name} />
        <div>
          <div className="text-xl font-semibold">{doc.name}</div>
          <div className="text-base text-neutral-400">
            {doc.role} · {doc.clinic}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
        {messages.map((m) => {
          const mine = m.from === 'patient';
          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-lg leading-snug ${
                  mine ? 'rounded-br-md bg-neutral-100 text-neutral-950' : 'rounded-bl-md bg-neutral-800 text-neutral-50'
                }`}
              >
                {m.text}
              </div>
              <span className="mt-1 text-sm text-neutral-500">
                {mine ? 'You' : doc.name} · {timeLabel(m.sent_at)}
              </span>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="flex gap-3 border-t border-neutral-800 p-4">
        <label className="sr-only" htmlFor="msg">
          Message {doc.name}
        </label>
        <input
          id="msg"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message ${doc.name}…`}
          className="min-h-[60px] min-w-0 flex-1 rounded-xl border border-neutral-600 bg-neutral-950 px-4 text-xl placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="inline-flex min-h-[60px] items-center gap-2 rounded-xl bg-neutral-100 px-6 text-xl font-semibold text-neutral-950 disabled:opacity-40"
        >
          <Send className="h-5 w-5" /> Send
        </button>
      </form>
    </div>
  );
}
