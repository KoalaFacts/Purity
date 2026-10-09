// Lifecycle benchmark — idiomatic React version.
// Uses: useState, map over cards. Plain React, no signals.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

// ---------------------------------------------------------------------------
// Types and data generation
// ---------------------------------------------------------------------------

interface Card {
  id: number;
  label: string;
}

let nextId = 1;
function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    d[i] = { id, label: `Card ${id}` };
  }
  return d;
}

// ---------------------------------------------------------------------------
// Hidden benchmark button helper
// ---------------------------------------------------------------------------

function HBtn(props: { id: string; onClick: () => void; children: string }) {
  return (
    <button type="button" id={props.id} style={{ display: 'none' }} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  const [cards, setCards] = useState<Card[]>([]);

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Lifecycle)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="create-1k"
                  onClick={() => setCards(buildCards(1000))}
                >
                  Create 1k
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="create-10k"
                  onClick={() => setCards(buildCards(10000))}
                >
                  Create 10k
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="destroy-all"
                  onClick={() => setCards([])}
                >
                  Destroy All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="replace"
                  onClick={() => setCards(buildCards(1000))}
                >
                  Replace 1k
                </button>
              </div>
              <HBtn id="create-10" onClick={() => setCards(buildCards(10))}>
                Create 10
              </HBtn>
              <HBtn id="create-100" onClick={() => setCards(buildCards(100))}>
                Create 100
              </HBtn>
              <HBtn id="replace-10" onClick={() => setCards(buildCards(10))}>
                Replace 10
              </HBtn>
              <HBtn id="replace-100" onClick={() => setCards(buildCards(100))}>
                Replace 100
              </HBtn>
              <HBtn id="replace-10k" onClick={() => setCards(buildCards(10000))}>
                Replace 10,000
              </HBtn>
            </div>
          </div>
        </div>
      </div>
      <div id="container">
        {cards.map((card) => (
          <div key={card.id} className="card">
            <span className="id">{card.id}</span>
            <span className="label">{card.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
