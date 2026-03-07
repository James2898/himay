import Mixer from "./components/Mixer";
import DebugConsole from "./components/DebugConsole";
import "./index.css";

const App = () => {
  return (
    <main>
      <Mixer />
      {/* This will only show a small "DEBUG" button initially */}
      <DebugConsole />
    </main>
  );
};

export default App;
