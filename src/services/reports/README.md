# Super Admin reports (UEMS)

Three accountability exports for the Super Admin **Reports** tab:

1. **Audit Trail** — rows from `workflow_timeline`, joined to `exam_papers` and `user_profiles`.
2. **Exam Paper Status** — snapshot per row in `exam_papers` with stage derived from `status` / `approval_status`.
3. **Chief Examiner Sign-off** — approved papers (`approval_status` or `status` = `approved_for_printing`) plus rejected/deferred where applicable.

**Requirements**

- Supabase tables: `exam_papers`, `workflow_timeline`, `user_profiles`.
- Workflow events should be written via `addWorkflowEvent` / `workflow_timeline` inserts for a complete audit trail.

**Optional future fields**

- IP / device: add columns to `workflow_timeline` or a separate `audit_log` and map them in `buildAuditTrailReport`.
- Lead vetter: join `vetting_assignments` in `reportDataService` and pass into `buildChiefSignOffReport`.
