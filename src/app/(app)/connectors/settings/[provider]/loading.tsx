import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConnectorProviderSettingsLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-72" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="space-y-2" key={i}>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-60" />
            </div>
          ))}
          <Skeleton className="h-10 w-40" />
        </CardContent>
      </Card>
    </div>
  );
}
