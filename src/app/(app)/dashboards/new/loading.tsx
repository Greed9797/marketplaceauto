import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardNewLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-56" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-2 h-3 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div className="space-y-2" key={i}>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
          <Skeleton className="h-10 w-32" />
        </CardContent>
      </Card>
    </div>
  );
}
