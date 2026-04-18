'use client';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Field, Button, Alert } from '@/components/UI';

export default function EmailPage() {
  const { isOwner } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [day, setDay] = useState('monday');
  const [email, setEmail] = useState('owner@myshop.com');
  const [saved, setSaved] = useState(false);

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;

  return (<div>
    <PageHeader title="📧 Weekly Email Reports" subtitle="Auto-send every Monday morning" />
    {saved && <Alert type="success">Settings saved!</Alert>}
    <div className="bg-[var(--bg-elevated)] rounded-xl p-5 border border-[var(--border-subtle)] max-w-lg">
      <Field label="Enable Reports">
        <button onClick={() => setEnabled(!enabled)} className="w-11 h-6 rounded-full relative cursor-pointer border" style={{ background: enabled ? '#34D399' : '#131C28', borderColor: enabled ? '#34D399' : '#1A2536' }}>
          <div className="w-[18px] h-[18px] rounded-full bg-white absolute top-[2px] transition-all" style={{ left: enabled ? 22 : 2 }} />
        </button>
      </Field>
      <Field label="Send Day"><select value={day} onChange={e => setDay(e.target.value)}>
        {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>)}
      </select></Field>
      <Field label="Owner Email"><input value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 3000); }} className="w-full !mt-2">Save Settings</Button>
      <p className="text-[var(--text-muted)] text-[11px] mt-3">In production, connects to SendGrid/SMTP to auto-send every {day} at 7 AM with each store's weekly summary.</p>
    </div>
  </div>);
}
