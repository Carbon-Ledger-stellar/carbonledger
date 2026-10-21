'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AccountSettings {
  name: string;
  email: string;
  bio: string;
}

interface AccountSettingsFormProps {
  initialValues: AccountSettings;
  onSave: (values: AccountSettings) => Promise<void>;
}

function isEqual(a: AccountSettings, b: AccountSettings): boolean {
  return a.name === b.name && a.email === b.email && a.bio === b.bio;
}

export default function AccountSettingsForm({
  initialValues,
  onSave,
}: AccountSettingsFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<AccountSettings>(initialValues);
  const [savedValues, setSavedValues] = useState<AccountSettings>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !isEqual(values, savedValues);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Warn on tab close / reload while there are unsaved changes.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Warn on in-app route change (client-side navigation) while dirty.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.target === '_blank') return;

      const nextUrl = new URL(href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;
      if (nextUrl.pathname === window.location.pathname) return;

      const confirmed = window.confirm(
        'You have unsaved changes. Leave this page and discard them?'
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  const handleChange = useCallback(
    (field: keyof AccountSettings) =>
      (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
      ) => {
        const { value } = event.target;
        setValues((prev) => ({ ...prev, [field]: value }));
      },
    []
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      setSavedValues(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          type="text"
          value={values.name}
          onChange={handleChange('name')}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={values.email}
          onChange={handleChange('email')}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="bio" className="block text-sm font-medium">
          Bio
        </label>
        <textarea
          id="bio"
          value={values.bio}
          onChange={handleChange('bio')}
          rows={4}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && (
          <span className="text-sm text-amber-600">Unsaved changes</span>
        )}
      </div>
    </form>
  );
}
