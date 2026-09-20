import { attendanceLabel, reportMetrics, reportTime, type TeamActivityReport } from "../../lib/team-reports";

export function TeamReportView({ report }: { report: TeamActivityReport }) {
  return <div className="team-report-document" dir="rtl">
    <p className="report-period"><strong>{report.start} — {report.end}</strong><span>{report.partial ? "اليوم لم ينتهِ — تقرير مبدئي" : "فترة مكتملة"}</span></p>
    <p className="muted">بتوقيت القاهرة · تم إعداد التقرير {reportTime(report.generated_at)}. سجل الحضور متاح منذ {reportTime(report.presence_since)}.</p>
    <p className="report-evidence-note">الدخول ليس إنجازًا، وعدم وجود نشاط لا يثبت الغياب. الأرقام تخص السجل داخل المنصة فقط؛ العمل خارجها والإجازات لا تظهر تلقائيًا. لا تُعرض نصوص السكريبتات الخاصة أو محادثات العملاء.</p>
    {!report.members.length ? <p>لا يوجد أعضاء مشمولون في هذه الفترة.</p> : report.members.map(member => <article key={member.user_id} className="member-activity-report">
      <header><h3>{member.name}</h3><span>{attendanceLabel(member, report)}</span></header>
      <dl className="member-report-metrics">{["deliveries", "completed", "content_created", "scripts_edited"].map(key => <div key={key}><dt>{reportMetrics[key]}</dt><dd>{member.metrics[key] ?? 0}</dd></div>)}</dl>
      <details><summary>كل تفاصيل النشاط</summary>
        <dl className="member-report-details">{Object.entries(reportMetrics).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{member.metrics[key] ?? 0}</dd></div>)}
          <div><dt>منشورات تلقائية مؤكدة لمحتواه على تيليجرام</dt><dd>{member.auto_published}</dd></div>
          <div><dt>مهام متأخرة مفتوحة وقت إعداد التقرير</dt><dd>{member.overdue_now}</dd></div>
          <div><dt>أول ظهور في الفترة</dt><dd>{reportTime(member.first_seen)}</dd></div><div><dt>آخر ظهور في الفترة</dt><dd>{reportTime(member.last_seen)}</dd></div>
          <div><dt>آخر نشاط عمل محسوب</dt><dd>{reportTime(member.last_activity)}</dd></div>
        </dl>
        <p className="muted">التعديل المتكرر لنفس العنصر يُحسب مرة في كل نوع نشاط خلال الفترة. تسليم النشر لا يثبت النشر الخارجي؛ المؤكد تلقائيًا من سجل تيليجرام منفصل، ولا يعني أن العضو نفّذه يدويًا. اكتمال المهمة يُنسب لمسؤولها وقت الإكمال، وليس لمن ضغط الموافقة.</p>
      </details>
    </article>)}
  </div>;
}
