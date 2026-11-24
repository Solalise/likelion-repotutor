import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import type { RepositoryAnalysis, SourceInput } from "@/types/analysis";

/** Synthetic sources only. No customer repository or credentials. */
export const reviewFeatureSources: SourceInput[] = [
  { path: "app/about/page.tsx", content: `export default function About() {
  const title = "About";
  return <article><h1>{title}</h1><p>Static introduction</p></article>;
}` },
  { path: "app/contacts/page.tsx", content: `import { createContact, getContacts } from "../../actions/contacts";
export default async function ContactsPage() {
  const contacts = await getContacts();
  return <main><h1>문의 게시판</h1>
    <form action={createContact}><textarea name="message"/><button>Save</button></form>
    {contacts.map(contact => <p key={contact._id}>{contact.message}</p>)}
  </main>;
}` },
  { path: "app/contacts/[id]/page.tsx", content: `import { getContact } from "../../../actions/contacts";
export default async function ContactPage({ params }) {
  const contact = await getContact(params.id);
  return <p>{contact.message}</p>;
}` },
  { path: "app/admin/contacts/page.tsx", content: `import { deleteContact, getContacts } from "../../../actions/contacts";
export default async function AdminPage() {
  const contacts = await getContacts();
  return <main><h1>관리자 문의 관리</h1>{contacts.map(contact =>
    <form action={deleteContact} key={contact._id}><input name="id" value={contact._id}/><p>{contact.message}</p><button>Delete</button></form>)}
  </main>;
}` },
  { path: "actions/contacts.ts", content: `"use server";
import { Contact } from "../models/contact";
import { auth } from "../auth";
export async function createContact(formData: FormData) {
  const session = await auth();
  const message = formData.get("message");
  return Contact.create({ message, ownerId: session.user.id });
}
export async function getContacts() {
  const session = await auth();
  return Contact.find({ ownerId: session.user.id });
}
export async function getContact(id: string) {
  return Contact.findById(id);
}
export async function deleteContact(formData: FormData) {
  const session = await auth();
  if (session.user.role !== "admin") throw new Error("Forbidden");
  const id = formData.get("id");
  return Contact.findByIdAndDelete(id);
}` },
  { path: "auth.ts", content: `export async function auth() { return { user: { id: "synthetic-a", role: "user" } }; }` },
  { path: "models/contact.ts", content: `import mongoose from "mongoose"; export const Contact = mongoose.model("Contact", new mongoose.Schema({ message: String, ownerId: String }));` },
];
export function reviewFeatureAnalysis(): RepositoryAnalysis {
  return { ...analyzeSourceFiles(reviewFeatureSources, "synthetic/review-guide"), collection: { source: "github", commitSha: "a".repeat(40), discoveredFiles: reviewFeatureSources.length, collectedFiles: reviewFeatureSources.length, totalBytes: 0, partial: false, durationMs: 0 },
    technology: { frameworks: ["Next.js"], databases: ["MongoDB"], persistence: ["Mongoose (ODM)"], evidence: [], notes: [] } };
}
