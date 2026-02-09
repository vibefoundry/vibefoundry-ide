import Markdown from 'react-markdown'

const MarkdownViewer = ({ content }) => {
  return (
    <div className="markdown-viewer">
      <Markdown>{content.content}</Markdown>
    </div>
  )
}

export default MarkdownViewer
