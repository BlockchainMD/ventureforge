'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';

/** Budget, horizon and confidence floor. State lives in the URL so a plan is shareable. */
export function BudgetForm({
  budget,
  months,
  confidence,
}: {
  budget: number;
  months: number;
  confidence: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ budget: String(budget), months: String(months), confidence });

  const apply = (): void => {
    const params = new URLSearchParams({
      budget: form.budget,
      months: form.months,
      confidence: form.confidence,
    });
    startTransition(() => router.push(`/allocate?${params.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <label className="block w-32">
        <span className="rule-label">Budget ($)</span>
        <Input
          className="mt-0.5"
          type="number"
          value={form.budget}
          onChange={(event) => setForm({ ...form, budget: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply();
          }}
        />
      </label>
      <label className="block w-28">
        <span className="rule-label">Max hold (mo)</span>
        <Input
          className="mt-0.5"
          type="number"
          value={form.months}
          onChange={(event) => setForm({ ...form, months: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply();
          }}
        />
      </label>
      <label className="block w-36">
        <span className="rule-label">Min confidence</span>
        <Select
          className="mt-0.5"
          value={form.confidence}
          onChange={(event) => setForm({ ...form, confidence: event.target.value })}
        >
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
        </Select>
      </label>
      <Button onClick={apply} disabled={pending} variant="default">
        {pending ? 'Planning…' : 'Plan'}
      </Button>
    </div>
  );
}
