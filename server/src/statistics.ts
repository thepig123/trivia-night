import type {CategoryStats, GameStats, QuestionRecord, Team, TeamStats} from "./types.js";

function categorySummary(records: QuestionRecord[]): CategoryStats[] {
  return [...new Set(records.map(q=>q.category))].sort().map(category=>{
    const questions=records.filter(q=>q.category===category);
    const attempts=questions.flatMap(q=>q.attempts).filter(a=>a.correct!==null);
    const correct=attempts.filter(a=>a.correct).length;
    return {category,questions:questions.filter(q=>q.resolved).length,attempts:attempts.length,correct,wrong:attempts.length-correct,accuracy:attempts.length?correct/attempts.length:null};
  });
}
function extremes(categories: CategoryStats[]) {
  const ranked=categories.filter(c=>c.attempts>=3).sort((a,b)=>a.accuracy!-b.accuracy! || b.attempts-a.attempts || a.category.localeCompare(b.category));
  return {hardestCategory:ranked[0]??null,easiestCategory:[...ranked].sort((a,b)=>b.accuracy!-a.accuracy! || b.attempts-a.attempts || a.category.localeCompare(b.category))[0]??null};
}
export function summarizeStats(history: QuestionRecord[], teams: Team[]): GameStats {
  const records=history.filter(q=>!q.voided);
  const categories=categorySummary(records);
  const perTeam:TeamStats[]=teams.map(team=>{
    const attempts=records.flatMap(q=>q.attempts.filter(a=>a.teamId===team.id).map(a=>({...a,round:q.round})));
    const judged=attempts.filter(a=>a.correct!==null),buzzes=attempts.filter(a=>a.buzzMs!==undefined);
    const times=buzzes.map(a=>a.buzzMs!);
    const correct=judged.filter(a=>a.correct).length;
    const teamCategories=categorySummary(records.map(q=>({...q,attempts:q.attempts.filter(a=>a.teamId===team.id)})).filter(q=>q.attempts.length));
    return {teamId:team.id,buzzCount:times.length,firstBuzzes:buzzes.filter(a=>!a.rebound).length,averageBuzzMs:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null,fastestBuzzMs:times.length?Math.min(...times):null,slowestBuzzMs:times.length?Math.max(...times):null,correct,wrong:judged.length-correct,accuracy:judged.length?correct/judged.length:null,questionsSeen:records.filter(q=>q.resolved && q.eligibleTeamIds.includes(team.id)).length,mainCorrect:attempts.filter(a=>a.correct && a.round==="main").length,playoffCorrect:attempts.filter(a=>a.correct && a.round==="playoff").length,finalCorrect:attempts.filter(a=>a.correct && a.round==="final").length,categories:teamCategories,...extremes(teamCategories)};
  });
  const fastest=perTeam.filter(t=>t.fastestBuzzMs!==null).sort((a,b)=>a.fastestBuzzMs!-b.fastestBuzzMs!)[0];
  const most=perTeam.filter(t=>t.correct>0).sort((a,b)=>b.correct-a.correct)[0];
  return {trackedQuestions:records.length,completedQuestions:records.filter(q=>q.resolved).length,skippedQuestions:records.filter(q=>q.skipped).length,teams:perTeam,categories,fastestBuzz:fastest?{teamId:fastest.teamId,milliseconds:fastest.fastestBuzzMs!}:null,mostCorrectTeamIds:most?perTeam.filter(t=>t.correct===most.correct).map(t=>t.teamId):[],...extremes(categories)};
}
