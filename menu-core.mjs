// ActivityWatch lists a custom page in its "Activity" menu only when the
// `views` setting has a view with a `custom_vis` element naming that page.
export function pageName(pathname) {
  const match = /^\/pages\/([^/]+)\/?/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : "";
}
export function hasView(views, name) {
  return (
    Array.isArray(views) &&
    views.some((view) =>
      (view?.elements ?? []).some(
        (element) =>
          element?.type === "custom_vis" && element.props?.visname === name,
      ),
    )
  );
}
export function addView(views, name, title = "Projects") {
  const list = Array.isArray(views) ? views : [];
  const taken = new Set(list.map((view) => view?.id));
  let id = name;
  for (let i = 2; taken.has(id); i++) id = `${name}-${i}`;
  return [
    ...list,
    {
      id,
      name: title,
      elements: [
        { type: "custom_vis", size: 12, props: { title, visname: name } },
      ],
    },
  ];
}
