import { InventoryUpdate, SKILL_LIST, skillLevel, xpForLevel } from '@holdout/shared';

export function SkillsPanel({ inventory }: { inventory: InventoryUpdate }) {
  return (
    <div className="panel skills-panel">
      <h3>SKILLS<span className="sub">K to close</span></h3>
      {SKILL_LIST.map((skill) => {
        const xp = inventory.skills[skill.id] ?? 0;
        const level = skillLevel(xp);
        const currentLevelXp = xpForLevel(level);
        const nextLevelXp = xpForLevel(level + 1);
        const progress = level >= 50 ? 100 : Math.round(((xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100);
        return (
          <div className="skill-row" key={skill.id}>
            <div className="sk-head"><b>{skill.name}</b><span className="sk-lvl">LV {level}</span></div>
            <div className="sk-bar"><div style={{ width: `${progress}%` }} /></div>
            <div className="sk-bonus">{skill.bonus}</div>
          </div>
        );
      })}
    </div>
  );
}
