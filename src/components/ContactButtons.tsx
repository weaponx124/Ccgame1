import type { Customer } from "../types";
import { mailtoHref, smsHref, telHref } from "../lib/contact";
import { ChatIcon, MailIcon, PhoneIcon } from "./icons";

export function ContactButtons({
  customer,
  smsBody,
  mailSubject,
  mailBody,
  size = "md",
}: {
  customer: Customer;
  smsBody?: string;
  mailSubject?: string;
  mailBody?: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "p-2" : "p-2.5";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-4.5 w-4.5";

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {customer.phone && (
        <a
          href={telHref(customer.phone)}
          className={`rounded-full bg-moss-100 text-moss-700 ${pad} hover:bg-moss-200 transition`}
          aria-label={`Call ${customer.name}`}
        >
          <PhoneIcon className={iconSize} />
        </a>
      )}
      {customer.phone && (
        <a
          href={smsHref(customer.phone, smsBody ?? "")}
          className={`rounded-full bg-clay-400/20 text-clay-600 ${pad} hover:bg-clay-400/30 transition`}
          aria-label={`Text ${customer.name}`}
        >
          <ChatIcon className={iconSize} />
        </a>
      )}
      {customer.email && (
        <a
          href={mailtoHref(customer.email, mailSubject ?? "", mailBody ?? "")}
          className={`rounded-full bg-bark-100 text-bark-600 ${pad} hover:bg-bark-100/70 transition`}
          aria-label={`Email ${customer.name}`}
        >
          <MailIcon className={iconSize} />
        </a>
      )}
    </div>
  );
}
