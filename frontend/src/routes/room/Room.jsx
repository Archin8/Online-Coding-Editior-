import { useEffect, useState, useRef } from "react";
import AceEditor from "react-ace";
import { Toaster, toast } from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";
import { generateColor } from "../../utils";
import "./Room.css";

import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/mode-css";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-yaml";

import "ace-builds/src-noconflict/keybinding-emacs";
import "ace-builds/src-noconflict/keybinding-vim";

import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/ext-searchbox";
import "ace-builds/src-noconflict/theme-monokai";

const BASE_URL = import.meta.env.MODE === "development" ? "http://localhost:5000" : "";

const COMPILABLE_LANGUAGES = ["javascript", "java", "c_cpp", "python", "typescript", "golang"];

export default function Room({ socket }) {
  const navigate = useNavigate()
  const { roomId } = useParams()
  const [fetchedUsers, setFetchedUsers] = useState(() => [])
  const [fetchedCode, setFetchedCode] = useState(() => "")
  const [language, setLanguage] = useState(() => "javascript")
  const [codeKeybinding, setCodeKeybinding] = useState(() => undefined)

  // Compiler state
  const [isRunning, setIsRunning] = useState(false)
  const [outputData, setOutputData] = useState(null)
  const [showOutput, setShowOutput] = useState(false)
  const outputRef = useRef(null)

  const languagesAvailable = ["javascript", "java", "c_cpp", "python", "typescript", "golang", "yaml", "html"]
  const codeKeybindingsAvailable = ["default", "emacs", "vim"]

  function onChange(newValue) {
    setFetchedCode(newValue)
    socket.emit("update code", { roomId, code: newValue })
    socket.emit("syncing the code", { roomId: roomId })
  }

  function handleLanguageChange(e) {
    setLanguage(e.target.value)
    socket.emit("update language", { roomId, languageUsed: e.target.value })
    socket.emit("syncing the language", { roomId: roomId })
  }

  function handleCodeKeybindingChange(e) {
    setCodeKeybinding(e.target.value === "default" ? undefined : e.target.value)
  }

  function handleLeave() {
    socket.disconnect()
    !socket.connected && navigate('/', { replace: true, state: {} })
  }

  function copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text);
      toast.success('Room ID copied')
    } catch (exp) {
      console.error(exp)
    }
  }

  async function handleRunCode() {
    if (!fetchedCode.trim()) {
      toast.error("No code to run");
      return;
    }

    if (!COMPILABLE_LANGUAGES.includes(language)) {
      toast.error(`${language} is not supported for execution`);
      return;
    }

    setIsRunning(true);
    setShowOutput(true);
    setOutputData(null);

    try {
      const response = await fetch(`${BASE_URL}/api/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: fetchedCode, language }),
      });

      const result = await response.json();
      setOutputData(result);

      if (result.timedOut) {
        toast.error("Execution timed out");
      }
    } catch (err) {
      setOutputData({
        output: "",
        error: `Failed to connect to server: ${err.message}`,
        exitCode: 1,
        executionTime: 0,
        timedOut: false,
      });
      toast.error("Failed to run code");
    } finally {
      setIsRunning(false);
    }
  }

  // Auto-scroll output to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputData]);

  useEffect(() => {
    socket.on("updating client list", ({ userslist }) => {
      setFetchedUsers(userslist)
    })

    socket.on("on language change", ({ languageUsed }) => {
      setLanguage(languageUsed)
    })

    socket.on("on code change", ({ code }) => {
      setFetchedCode(code)
    })

    socket.on("new member joined", ({ username }) => {
      toast(`${username} joined`)
    })

    socket.on("member left", ({ username }) => {
      toast(`${username} left`)
    })

    const backButtonEventListner = window.addEventListener("popstate", function (e) {
      const eventStateObj = e.state
      if (!('usr' in eventStateObj) || !('username' in eventStateObj.usr)) {
        socket.disconnect()
      }
    });

    return () => {
      window.removeEventListener("popstate", backButtonEventListner)
    }
  }, [socket])

  const canRun = COMPILABLE_LANGUAGES.includes(language);

  return (
    <div className="room">
      <div className="roomSidebar">
        <div className="roomSidebarUsersWrapper">
          <div className="languageFieldWrapper">
            <select className="languageField" name="language" id="language" value={language} onChange={handleLanguageChange}>
              {languagesAvailable.map(eachLanguage => (
                <option key={eachLanguage} value={eachLanguage}>{eachLanguage}</option>
              ))}
            </select>
          </div>

          <div className="languageFieldWrapper">
            <select className="languageField" name="codeKeybinding" id="codeKeybinding" value={codeKeybinding} onChange={handleCodeKeybindingChange}>
              {codeKeybindingsAvailable.map(eachKeybinding => (
                <option key={eachKeybinding} value={eachKeybinding}>{eachKeybinding}</option>
              ))}
            </select>
          </div>

          {canRun && (
            <button
              className={`runCodeBtn ${isRunning ? 'runCodeBtnRunning' : ''}`}
              onClick={handleRunCode}
              disabled={isRunning}
              id="runCodeBtn"
            >
              {isRunning ? (
                <>
                  <span className="runCodeSpinner"></span>
                  Running...
                </>
              ) : (
                <>
                  <span className="runCodePlayIcon">▶</span>
                  Run Code
                </>
              )}
            </button>
          )}

          <p>Connected Users:</p>
          <div className="roomSidebarUsers">
            {fetchedUsers.map((each) => (
              <div key={each} className="roomSidebarUsersEach">
                <div className="roomSidebarUsersEachAvatar" style={{ backgroundColor: `${generateColor(each)}` }}>{each.slice(0, 2).toUpperCase()}</div>
                <div className="roomSidebarUsersEachName">{each}</div>
              </div>
            ))}
          </div>
        </div>

        <button className="roomSidebarCopyBtn" onClick={() => { copyToClipboard(roomId) }}>Copy Room id</button>
        <button className="roomSidebarBtn" onClick={() => {
          handleLeave()
        }}>Leave</button>
      </div>

      <div className="editorAndOutputWrapper">
        <AceEditor
          placeholder="Write your code here."
          className="roomCodeEditor"
          mode={language}
          keyboardHandler={codeKeybinding}
          theme="monokai"
          name="collabEditor"
          width="100%"
          height="100%"
          value={fetchedCode}
          onChange={onChange}
          fontSize={15}
          showPrintMargin={true}
          showGutter={true}
          highlightActiveLine={true}
          enableLiveAutocompletion={true}
          enableBasicAutocompletion={false}
          enableSnippets={false}
          wrapEnabled={true}
          tabSize={2}
          editorProps={{
            $blockScrolling: true
          }}
        />

        {showOutput && (
          <div className="outputPanel">
            <div className="outputPanelHeader">
              <div className="outputPanelHeaderLeft">
                <span className="outputPanelTitle">Output</span>
                {outputData && (
                  <span className={`outputPanelBadge ${outputData.exitCode === 0 ? 'outputPanelBadgeSuccess' : 'outputPanelBadgeError'}`}>
                    {outputData.exitCode === 0 ? '✓ Success' : `✗ Exit code: ${outputData.exitCode}`}
                  </span>
                )}
                {outputData && (
                  <span className="outputPanelTime">
                    {(outputData.executionTime / 1000).toFixed(2)}s
                  </span>
                )}
              </div>
              <button className="outputPanelCloseBtn" onClick={() => setShowOutput(false)}>✕</button>
            </div>
            <div className="outputPanelContent" ref={outputRef}>
              {isRunning && (
                <div className="outputPanelLoading">
                  <div className="outputPanelLoadingDots">
                    <span></span><span></span><span></span>
                  </div>
                  <p>Executing code...</p>
                </div>
              )}
              {outputData && (
                <>
                  {outputData.output && (
                    <pre className="outputPanelStdout">{outputData.output}</pre>
                  )}
                  {outputData.error && (
                    <pre className="outputPanelStderr">{outputData.error}</pre>
                  )}
                  {!outputData.output && !outputData.error && (
                    <p className="outputPanelEmpty">Program finished with no output.</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <Toaster />
    </div>
  )
}