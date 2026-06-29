import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileDeleteAccountLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-64" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-52" />
          <Skeleton className="mt-2 h-3 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-40" />
        </CardContent>
      </Card>
    </div>
  );
}
