import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card className="min-h-[168px]" key={index}>
            <CardHeader>
              <div className="h-3 w-28 rounded bg-[var(--bg-elevated)]" />
            </CardHeader>
            <CardContent>
              <div className="h-10 w-36 rounded bg-[var(--bg-elevated)]" />
              <div className="mt-4 h-4 w-44 rounded bg-[var(--bg-elevated)]" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="min-h-[360px]">
        <CardHeader>
          <div className="h-3 w-44 rounded bg-[var(--bg-elevated)]" />
        </CardHeader>
        <CardContent>
          <div className="h-[300px] rounded bg-[var(--bg-elevated)]" />
        </CardContent>
      </Card>
    </div>
  );
}
