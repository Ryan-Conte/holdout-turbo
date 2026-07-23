export default function AdminSectionLoading() {
  return (
    <section className="engine-editor">
      <div className="admin-editor-loading" role="status" aria-live="polite">
        <span className="spinner" />
        <b>LOADING ADMIN WORKSPACE...</b>
      </div>
    </section>
  );
}
