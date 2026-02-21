from dataclasses import dataclass
from typing import Dict

@dataclass
class ScopeState:
    ema: float = 0.0
    active: bool = False

class EMAHysteresis:
    def __init__(self, beta: float, theta_enter: float, alpha_exit: float):
        self.beta = float(beta)
        self.theta_enter = float(theta_enter)
        self.theta_exit = float(alpha_exit) * float(theta_enter)
        self.state: Dict[str, ScopeState] = {}

    def step(self, scope_key: str, severity: float) -> ScopeState:
        st = self.state.get(scope_key, ScopeState())
        st.ema = (1.0 - self.beta) * float(severity) + self.beta * float(st.ema)

        enter = False
        exit = False
        if (not st.active) and st.ema >= self.theta_enter:
            st.active = True
            enter = True
        elif st.active and st.ema <= self.theta_exit:
            st.active = False
            exit = True

        self.state[scope_key] = st
        st.enter = enter  # attach for convenience
        st.exit = exit
        return st
