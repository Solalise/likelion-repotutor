import { notFound } from "next/navigation";
import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { LearningCourse } from "@/components/learning/Learning";
import { courses, getCourse } from "@/lib/learn/courses";
export function generateStaticParams() { return courses.map(c => ({ topic: c.id })); }
export async function generateMetadata({ params }: {
    params: Promise<{
        topic: string;
    }>;
}) {
    const { topic } = await params;
    return { title: `${getCourse(topic)?.title ?? "찾을 수 없는 과정"} 기초 학습` };
}
export default async function Page({ params }: {
    params: Promise<{
        topic: string;
    }>;
}) {
    const { topic } = await params;
    const course = getCourse(topic);
    if (!course)
        notFound();
    return <PlatformShell><LearningCourse key={course.id} course={course}/></PlatformShell>;
}
