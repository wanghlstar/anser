import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatAddress, parseAddresses } from "./addresses";
import { senderName } from "./providers";
import type { Address, Contact } from "./types";

export type ContactDirectory = {
  names: ReadonlyMap<string, string>;
  emails: ReadonlySet<string>;
  editContact?: (address: Address) => void;
  displayName: (raw: string) => string;
  displayAddress: (address: Address) => string;
  formatRecipients: (raw: string, separator?: string) => string;
};

const EMPTY_NAMES = new Map<string, string>();
const EMPTY_EMAILS = new Set<string>();
const EMPTY: ContactDirectory = {
  names: EMPTY_NAMES,
  emails: EMPTY_EMAILS,
  displayName: (raw) => senderName(raw),
  displayAddress: (address) => address.name || address.email,
  formatRecipients: (raw, separator = ", ") => raw,
};

const ContactNamesContext = createContext<ContactDirectory>(EMPTY);

export function contactDisplayName(
  address: Address,
  names: ReadonlyMap<string, string>,
) {
  return (
    names.get(address.email.toLowerCase()) || address.name || address.email
  );
}

export function displaySenderName(
  raw: string,
  names: ReadonlyMap<string, string>,
) {
  const address = parseAddresses(raw)[0];
  return address ? contactDisplayName(address, names) : senderName(raw);
}

export function formatRecipients(
  raw: string,
  names: ReadonlyMap<string, string>,
  separator = ", ",
) {
  const addresses = parseAddresses(raw);
  if (!addresses.length) return raw;
  return addresses
    .map((address) =>
      formatAddress({
        ...address,
        name: contactDisplayName(address, names),
      }),
    )
    .join(separator);
}

export function ContactDirectoryProvider({
  contacts,
  onEditContact,
  children,
}: {
  contacts: Contact[];
  onEditContact?: (address: Address) => void;
  children: ReactNode;
}) {
  const value = useMemo<ContactDirectory>(() => {
    const names = new Map<string, string>();
    const emails = new Set<string>();
    for (const contact of contacts) {
      const email = contact.email.trim().toLowerCase();
      if (!email) continue;
      emails.add(email);
      if (contact.name.trim()) names.set(email, contact.name.trim());
    }
    return {
      names,
      emails,
      editContact: onEditContact,
      displayName: (raw) => displaySenderName(raw, names),
      displayAddress: (address) => contactDisplayName(address, names),
      formatRecipients: (raw, separator = ", ") =>
        formatRecipients(raw, names, separator),
    };
  }, [contacts, onEditContact]);
  return (
    <ContactNamesContext.Provider value={value}>
      {children}
    </ContactNamesContext.Provider>
  );
}

export function useContactDirectory() {
  return useContext(ContactNamesContext);
}
