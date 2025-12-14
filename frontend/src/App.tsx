import type { Component } from 'solid-js';
import Navbar from './components/Navbar';

const App: Component = () => {
  return (
    <>
      <Navbar />
    <p class="text-4xl text-white-700 text-center py-20">Hello there!</p>
  </>
  );
};

export default App;
