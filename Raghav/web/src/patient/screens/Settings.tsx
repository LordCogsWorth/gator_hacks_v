// Profile details, plus adding physicians. Adding one sends a request (like a friend request)
// that the physician accepts from the care dashboard. Phone, gender and physicians are
// demo-only (localDemo.ts); the name comes from the care team's record in the API.
import { Check, Clock, Send, UserPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BigButton, Card, Initials } from '../components/Layout';
import { PatientChoice, useIdentity, usePatientList } from '../identity';
import {
  DEMO_PHYSICIAN_EMAILS,
  findPhysicianByEmail,
  getLinks,
  getPhysician,
  getProfile,
  removePhysician,
  requestPhysician,
  updateProfile,
  useDataChanges,
  type Gender,
} from '../localDemo';
import { usePatientData } from '../PatientData';
import { speak } from '../voice/useVoice';

const GENDERS: { v: Gender; label: string }[] = [
  { v: 'female', label: 'Female' },
  { v: 'male', label: 'Male' },
  { v: 'other', label: 'Other' },
  { v: 'prefer_not', label: 'Prefer not to say' },
];

const field = 'mt-2 block min-h-[56px] w-full rounded-xl border border-neutral-600 bg-neutral-950 px-4 text-xl text-neutral-50 placeholder:text-neutral-500';

export function Settings() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfileCard />
        <PhysiciansCard />
      </div>
      <SwitchPatient />
    </div>
  );
}

function ProfileCard() {
  const { patient } = usePatientData();
  const profile = getProfile(patient.id);
  const [phone, setPhone] = useState(profile.phone);
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [saved, setSaved] = useState(false);
  const digits = phone.replace(/\D/g, '');
  const phoneOk = digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  const valid = phoneOk;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    updateProfile(patient.id, { phone: phone.trim(), gender });
    setSaved(true);
    speak('Your details are saved.');
  };

  return (
    <Card title="Your details">
      <form onSubmit={save} className="space-y-5" onChange={() => setSaved(false)}>
        <div className="block text-lg font-medium">
          Name
          <div className={`${field} flex items-center text-neutral-300`}>{patient.name}</div>
          <span className="mt-1 block text-base text-neutral-400">From your care team's records. Ask them to change it.</span>
        </div>
        <label className="block text-lg font-medium">
          Phone number
          <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" />
          {!phoneOk && <span className="mt-1 block text-base text-red-300">Enter a 10-digit phone number.</span>}
        </label>
        <fieldset>
          <legend className="text-lg font-medium">Gender</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {GENDERS.map((g) => (
              <button
                type="button"
                key={g.v}
                onClick={() => {
                  setGender(g.v);
                  setSaved(false);
                }}
                aria-pressed={gender === g.v}
                className={`min-h-[56px] rounded-xl border px-4 text-lg font-medium ${
                  gender === g.v ? 'border-neutral-100 bg-neutral-100 text-neutral-950' : 'border-neutral-600 hover:bg-neutral-800'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!valid}
            className="inline-flex min-h-[60px] items-center gap-2 rounded-xl bg-neutral-100 px-8 text-xl font-semibold text-neutral-950 disabled:opacity-40"
          >
            Save changes
          </button>
          {saved && (
            <span className="flex items-center gap-2 text-lg text-green-400">
              <Check className="h-5 w-5" /> Saved
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function PhysiciansCard() {
  useDataChanges();
  const { patient } = usePatientData();
  const links = getLinks(patient.id);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const doc = findPhysicianByEmail(email);
    if (!doc) {
      setMessage({ ok: false, text: 'No physician found with that email. Check the spelling or ask your clinic.' });
      return;
    }
    const existing = links.find((l) => l.physicianId === doc.id);
    if (existing) {
      setMessage({ ok: false, text: `${doc.name} is already ${existing.status === 'accepted' ? 'on your care team' : 'waiting to accept your request'}.` });
      return;
    }
    requestPhysician(patient.id, doc.id);
    setEmail('');
    setMessage({ ok: true, text: `Request sent to ${doc.name}. You can message them once they accept.` });
    speak(`Request sent to ${doc.name}.`);
  };

  return (
    <Card title="Your physicians">
      <ul className="space-y-3">
        {links.map((l) => {
          const doc = getPhysician(l.physicianId);
          if (!doc) return null;
          const accepted = l.status === 'accepted';
          return (
            <li key={l.physicianId} className="flex flex-wrap items-center gap-4 rounded-xl bg-neutral-800 p-4">
              <Initials name={doc.name} />
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{doc.name}</div>
                <div className="text-base text-neutral-400">
                  {doc.role} · {doc.clinic}
                </div>
                <div className={`mt-1 flex items-center gap-1 text-base font-medium ${accepted ? 'text-green-400' : 'text-amber-300'}`}>
                  {accepted ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  {accepted ? 'Connected' : 'Request sent · waiting for them to accept'}
                </div>
              </div>
              <button
                onClick={() => removePhysician(patient.id, doc.id)}
                className="flex min-h-[48px] items-center gap-2 rounded-xl border border-neutral-600 px-4 text-base font-medium hover:bg-neutral-700"
              >
                <X className="h-4 w-4" /> {accepted ? 'Remove' : 'Cancel request'}
              </button>
            </li>
          );
        })}
        {links.length === 0 && <li className="text-lg text-neutral-400">No physicians yet.</li>}
      </ul>

      <form onSubmit={add} className="mt-6 border-t border-neutral-800 pt-6">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <UserPlus className="h-5 w-5" /> Add a physician
        </h3>
        <p className="mt-1 text-base text-neutral-400">Enter their email. They will get a request to join your care team.</p>
        <label className="mt-3 block text-lg font-medium">
          Physician's email
          <input
            className={field}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setMessage(null);
            }}
            placeholder="name@clinic.org"
          />
        </label>
        <BigButton className="mt-4">
          <Send className="h-5 w-5" /> Send request
        </BigButton>
        {message && <p className={`mt-3 text-lg ${message.ok ? 'text-green-400' : 'text-red-300'}`}>{message.text}</p>}
        <p className="mt-4 text-sm text-neutral-500">Demo physicians: {DEMO_PHYSICIAN_EMAILS.join(', ')}</p>
      </form>
    </Card>
  );
}

/** Demo only (no login yet): act as another patient on this device. */
function SwitchPatient() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-dashed border-neutral-700 p-5">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-[44px] text-base font-medium text-neutral-400 hover:text-neutral-200">
        Switch patient (demo) {open ? '▲' : '▼'}
      </button>
      {open && <PatientSwitchList />}
    </section>
  );
}

function PatientSwitchList() {
  const navigate = useNavigate();
  const { patientId, switchPatient } = useIdentity();
  const { patients, error } = usePatientList();
  if (error) return <p className="mt-3 text-lg text-red-300">Can't load patients ({error}).</p>;
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-3">
      {(patients ?? []).map((p) => (
        <li key={p.id}>
          <PatientChoice
            patient={p}
            current={p.id === patientId}
            onPick={(id) => {
              switchPatient(id);
              navigate('/patient');
            }}
          />
        </li>
      ))}
    </ul>
  );
}
