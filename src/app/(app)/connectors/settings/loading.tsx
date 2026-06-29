import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConnectorsSettingsLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-10 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
