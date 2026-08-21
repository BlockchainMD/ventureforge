'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="analyst@landalpha.local"
        />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      {state.error ? (
        <p className="rounded-sm border border-bad/30 bg-bad/10 px-2 py-1.5 text-xs text-bad">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" variant="default" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
