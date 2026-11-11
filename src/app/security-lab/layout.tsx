import { LabSessionProvider } from "@/components/security/LabSession";
/** Preserve the existing functional lab separately from the new UI-only pages. */
export default function ExistingLabLayout({children}:{children:React.ReactNode}) {
  return <LabSessionProvider>{children}</LabSessionProvider>;
}
