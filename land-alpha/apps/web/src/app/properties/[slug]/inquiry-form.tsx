'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { submitInquiryAction } from './actions';

/**
 * Buyer enquiry and offer form.
 *
 * Public and unauthenticated, so the server action treats every field as
 * hostile: types are validated, lengths capped, and nothing here can attach an
 * enquiry to a parcel other than the published listing being viewed.
 */
export function InquiryForm({ parcelId, slug }: { parcelId: string; slug: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="rounded-sm border border-good/30 bg-good/10 px-3 py-2 text-xs text-good">
        Thank you — your enquiry has been received. We will reply to the email address you provided.
      </p>
    );
  }

  return (
    <form
      className="space-y-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await submitInquiryAction(parcelId, slug, formData);
          if (result.ok) setSent(true);
          else setError(result.message);
        });
      }}
    >
      <Field label="Name">
        <Input name="name" required maxLength={120} autoComplete="name" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required maxLength={200} autoComplete="email" />
      </Field>
      <Field label="Phone (optional)">
        <Input name="phone" maxLength={40} autoComplete="tel" />
      </Field>
      <Field label="Offer amount ($, optional)">
        <Input name="offerAmount" type="number" min={0} />
      </Field>
      <Field label="Paying by">
        <select
          name="financing"
          className="h-7 w-full rounded-sm border border-line-strong bg-surface px-1.5 text-xs text-ink focus-ring"
        >
          <option value="">Prefer not to say</option>
          <option value="CASH">Cash</option>
          <option value="FINANCING">Financing</option>
          <option value="OWNER_FINANCING">Interested in owner financing</option>
        </select>
      </Field>
      <Field label="Message">
        <Textarea name="inquiry" rows={3} maxLength={2000} placeholder="Any questions?" />
      </Field>

      {error ? <p className="text-xs text-bad">{error}</p> : null}

      <Button type="submit" variant="default" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Send enquiry'}
      </Button>
      <p className="text-[10px] leading-relaxed text-ink-faint">
        Submitting an enquiry is not an offer to purchase and creates no obligation on either side.
      </p>
    </form>
  );
}
