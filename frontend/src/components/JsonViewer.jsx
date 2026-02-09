import { JsonView, darkStyles } from 'react-json-view-lite'
import 'react-json-view-lite/dist/index.css'

const JsonViewer = ({ content }) => {
  return (
    <div className="json-viewer">
      <JsonView
        data={content.data}
        style={darkStyles}
        shouldExpandNode={(level) => level < 2}
      />
    </div>
  )
}

export default JsonViewer
