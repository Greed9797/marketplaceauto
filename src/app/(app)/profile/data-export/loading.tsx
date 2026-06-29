import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileDataExportLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-56" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
