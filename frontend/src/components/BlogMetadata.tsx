import { Show } from "solid-js";

export type BlogDates = {
  published_at?: string;
  updated_at?: string;
  commit_url?: string;
};

function formatDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default function BlogMetadata(props: { post: BlogDates; link?: boolean }) {
  const commitURL = () =>
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[a-f0-9]+$/i.test(
      props.post.commit_url || ""
    )
      ? props.post.commit_url
      : undefined;
  return (
    <Show when={formatDate(props.post.published_at)}>
      <div class="blog-metadata">
        <span>
          Published{" "}
          <time dateTime={props.post.published_at} title={props.post.published_at}>
            {formatDate(props.post.published_at)}
          </time>
        </span>
        <Show when={formatDate(props.post.updated_at)}>
          <span>
            Last updated{" "}
            <time dateTime={props.post.updated_at} title={props.post.updated_at}>
              {formatDate(props.post.updated_at)}
            </time>
          </span>
        </Show>
        <Show when={props.link !== false && commitURL()}>
          <a href={commitURL()} target="_blank" rel="noopener noreferrer">
            View commit ↗
          </a>
        </Show>
      </div>
    </Show>
  );
}
