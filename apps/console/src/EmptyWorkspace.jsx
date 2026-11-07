import HomePage from "./features/home/HomePage.jsx";
import LeadsPage from "./features/leads/LeadsPage.jsx";
import MailPage from "./features/mail/MailPage.jsx";
import ProfilePage from "./features/profile/ProfilePage.jsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx";

const IMPLEMENTED_PAGES = { Home: HomePage, Leads: LeadsPage, Mail: MailPage, Profile: ProfilePage };

export default function EmptyWorkspace({ page, ...props }) {
  const Page = IMPLEMENTED_PAGES[page];
  if (Page) return <Page {...props} />;
  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-[520px] min-w-0 max-w-full rounded-lg border">
      <ResizablePanel defaultSize={66} minSize={45}>
        <section className="h-full min-w-0 p-5">
          <h2 className="mb-1 text-base font-semibold">{page} workspace</h2>
          <p className="mb-5 text-sm text-muted-foreground">Verified records appear here when connected.</p>
          <div className="workbench-table min-w-0 max-w-full rounded-md border"><Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Status</TableHead><TableHead>Next action</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell colSpan={3} className="h-40 text-center text-muted-foreground">No verified {page.toLowerCase()} records yet.</TableCell></TableRow></TableBody></Table></div>
        </section>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={34} minSize={25}><section className="flex h-full items-center justify-center p-6 text-center"><div><h2 className="font-semibold">Ready for review</h2><p className="mt-2 max-w-xs text-sm text-muted-foreground">This panel stays empty until real work is available.</p></div></section></ResizablePanel>
    </ResizablePanelGroup>
  );
}
